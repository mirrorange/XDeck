use anyhow::Result;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::AppError;

/// JWT Claims structure.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (user ID)
    pub sub: String,
    /// Username
    pub username: String,
    /// Role
    pub role: String,
    /// Expiration time (unix timestamp)
    pub exp: usize,
    /// Issued at (unix timestamp)
    pub iat: usize,
}

/// Auth service handles user authentication and JWT management.
pub struct AuthService {
    jwt_secret: String,
}

impl AuthService {
    pub fn new(jwt_secret: String) -> Self {
        Self { jwt_secret }
    }

    /// Check if initial setup has been completed (admin user exists).
    pub async fn is_setup_complete(pool: &SqlitePool) -> Result<bool> {
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
            .fetch_one(pool)
            .await?;
        Ok(count.0 > 0)
    }

    /// Create the initial admin user (first-time setup).
    pub async fn setup_admin(
        pool: &SqlitePool,
        username: &str,
        password: &str,
    ) -> Result<(), AppError> {
        // Check if already set up
        if Self::is_setup_complete(pool).await? {
            return Err(AppError::AlreadyExists(
                "Admin user already exists".to_string(),
            ));
        }

        let password_hash = hash_password(password)?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&id)
        .bind(username)
        .bind(&password_hash)
        .bind("admin")
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Authenticate with username and password, returns a JWT token.
    pub async fn login(
        &self,
        pool: &SqlitePool,
        username: &str,
        password: &str,
    ) -> Result<String, AppError> {
        if !Self::is_setup_complete(pool).await? {
            return Err(AppError::SetupRequired);
        }

        let row: Option<(String, String, String)> = sqlx::query_as(
            "SELECT id, password_hash, role FROM users WHERE username = ?1",
        )
        .bind(username)
        .fetch_optional(pool)
        .await?;

        let (user_id, stored_hash, role) =
            row.ok_or(AppError::InvalidCredentials)?;

        // Verify password
        verify_password(password, &stored_hash)?;

        // Generate JWT
        let token = self.generate_jwt(&user_id, username, &role)?;
        Ok(token)
    }

    /// Verify a JWT token and return the claims.
    pub fn verify_token(&self, token: &str) -> Result<Claims, AppError> {
        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|e| match e.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => AppError::TokenExpired,
            _ => AppError::Unauthorized,
        })?;

        Ok(token_data.claims)
    }

    /// Generate a JWT token for the given user.
    fn generate_jwt(
        &self,
        user_id: &str,
        username: &str,
        role: &str,
    ) -> Result<String, AppError> {
        let now = Utc::now();
        let expiration = now + chrono::Duration::hours(24);

        let claims = Claims {
            sub: user_id.to_string(),
            username: username.to_string(),
            role: role.to_string(),
            exp: expiration.timestamp() as usize,
            iat: now.timestamp() as usize,
        };

        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.jwt_secret.as_bytes()),
        )
        .map_err(|e| AppError::Internal(format!("JWT encoding failed: {}", e)))
    }

    /// Generate a random JWT secret.
    pub fn generate_secret() -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..64)
            .map(|_| {
                let idx = rng.gen_range(0..62);
                let chars = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                chars[idx] as char
            })
            .collect()
    }
}

/// Hash a password using Argon2.
fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut rand::rngs::OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Password hashing failed: {}", e)))?;
    Ok(hash.to_string())
}

/// Verify a password against a hash.
fn verify_password(password: &str, hash: &str) -> Result<(), AppError> {
    let parsed_hash =
        PasswordHash::new(hash).map_err(|e| AppError::Internal(format!("Invalid hash: {}", e)))?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| AppError::InvalidCredentials)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        pool
    }

    #[test]
    fn test_hash_and_verify_password() {
        let hash = hash_password("test_password").unwrap();
        assert!(verify_password("test_password", &hash).is_ok());
        assert!(verify_password("wrong_password", &hash).is_err());
    }

    #[tokio::test]
    async fn test_setup_and_login() {
        let pool = test_pool().await;
        let auth = AuthService::new("test-secret-key-12345".to_string());

        // Not set up yet
        assert!(!AuthService::is_setup_complete(&pool).await.unwrap());
        assert!(matches!(
            auth.login(&pool, "admin", "mypassword").await,
            Err(AppError::SetupRequired)
        ));

        // Setup admin
        AuthService::setup_admin(&pool, "admin", "mypassword")
            .await
            .unwrap();

        // Now set up
        assert!(AuthService::is_setup_complete(&pool).await.unwrap());

        // Can't setup again
        assert!(AuthService::setup_admin(&pool, "admin2", "pass")
            .await
            .is_err());

        // Login succeeds
        let token = auth.login(&pool, "admin", "mypassword").await.unwrap();
        assert!(!token.is_empty());

        // Verify token
        let claims = auth.verify_token(&token).unwrap();
        assert_eq!(claims.username, "admin");
        assert_eq!(claims.role, "admin");

        // Login with wrong password fails
        assert!(auth
            .login(&pool, "admin", "wrongpassword")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn test_jwt_verification() {
        let auth = AuthService::new("test-secret".to_string());
        let auth2 = AuthService::new("different-secret".to_string());
        let pool = test_pool().await;
        AuthService::setup_admin(&pool, "admin", "pass")
            .await
            .unwrap();

        let token = auth.login(&pool, "admin", "pass").await.unwrap();

        // Valid token
        assert!(auth.verify_token(&token).is_ok());

        // Invalid secret
        assert!(auth2.verify_token(&token).is_err());

        // Invalid token
        assert!(auth.verify_token("invalid.token.here").is_err());
    }
}
