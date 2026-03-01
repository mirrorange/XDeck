use std::sync::Arc;

use anyhow::Result;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::Database;
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
    pub fn is_setup_complete(db: &Database) -> Result<bool> {
        db.with_conn(|conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM users",
                [],
                |row| row.get(0),
            )?;
            Ok(count > 0)
        })
    }

    /// Create the initial admin user (first-time setup).
    pub fn setup_admin(db: &Database, username: &str, password: &str) -> Result<(), AppError> {
        // Check if already set up
        if Self::is_setup_complete(db)? {
            return Err(AppError::AlreadyExists(
                "Admin user already exists".to_string(),
            ));
        }

        let password_hash = hash_password(password)?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![id, username, password_hash, "admin", now, now],
            )?;
            Ok(())
        })?;

        Ok(())
    }

    /// Authenticate with username and password, returns a JWT token.
    pub fn login(
        &self,
        db: &Database,
        username: &str,
        password: &str,
    ) -> Result<String, AppError> {
        if !Self::is_setup_complete(db)? {
            return Err(AppError::SetupRequired);
        }

        let (user_id, stored_hash, role): (String, String, String) = db
            .with_conn(|conn| {
                let result = conn.query_row(
                    "SELECT id, password_hash, role FROM users WHERE username = ?1",
                    [username],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )?;
                Ok(result)
            })
            .map_err(|_| AppError::InvalidCredentials)?;

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

    fn test_db() -> Arc<Database> {
        let db = Arc::new(Database::new_in_memory().unwrap());
        db.run_migrations().unwrap();
        db
    }

    #[test]
    fn test_hash_and_verify_password() {
        let hash = hash_password("test_password").unwrap();
        assert!(verify_password("test_password", &hash).is_ok());
        assert!(verify_password("wrong_password", &hash).is_err());
    }

    #[test]
    fn test_setup_and_login() {
        let db = test_db();
        let auth = AuthService::new("test-secret-key-12345".to_string());

        // Not set up yet
        assert!(!AuthService::is_setup_complete(&db).unwrap());
        assert!(matches!(
            auth.login(&db, "admin", "mypassword"),
            Err(AppError::SetupRequired)
        ));

        // Setup admin
        AuthService::setup_admin(&db, "admin", "mypassword").unwrap();

        // Now set up
        assert!(AuthService::is_setup_complete(&db).unwrap());

        // Can't setup again
        assert!(AuthService::setup_admin(&db, "admin2", "pass").is_err());

        // Login succeeds
        let token = auth.login(&db, "admin", "mypassword").unwrap();
        assert!(!token.is_empty());

        // Verify token
        let claims = auth.verify_token(&token).unwrap();
        assert_eq!(claims.username, "admin");
        assert_eq!(claims.role, "admin");

        // Login with wrong password fails
        assert!(auth.login(&db, "admin", "wrongpassword").is_err());
    }

    #[test]
    fn test_jwt_verification() {
        let auth = AuthService::new("test-secret".to_string());
        let auth2 = AuthService::new("different-secret".to_string());
        let db = test_db();
        AuthService::setup_admin(&db, "admin", "pass").unwrap();

        let token = auth.login(&db, "admin", "pass").unwrap();

        // Valid token
        assert!(auth.verify_token(&token).is_ok());

        // Invalid secret
        assert!(auth2.verify_token(&token).is_err());

        // Invalid token
        assert!(auth.verify_token("invalid.token.here").is_err());
    }
}
