import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Server, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { useAuthStore } from "~/stores/auth-store";

export function meta() {
  return [
    { title: "XDeck — Initial Setup" },
    { name: "description", content: "Set up your XDeck admin account" },
  ];
}

export default function SetupPage() {
  const navigate = useNavigate();
  const { setup, isLoading, error, isSetupComplete } = useAuthStore();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isSetupComplete === true) {
      navigate("/login");
    }
  }, [isSetupComplete, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (password.length < 6) {
      setLocalError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setLocalError("Passwords do not match");
      return;
    }

    try {
      await setup(username, password);
      navigate("/login");
    } catch {
      // error is already set in the store
    }
  };

  const displayError = localError || error;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-background via-background to-muted/40 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/25">
            <Server className="size-7 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Welcome to XDeck</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Set up your administrator account to get started
            </p>
          </div>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Create Admin Account</CardTitle>
            <CardDescription>
              This account will have full access to manage your server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="setup-username">Username</Label>
                <Input
                  id="setup-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-password">Password</Label>
                <Input
                  id="setup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-confirm-password">Confirm Password</Label>
                <Input
                  id="setup-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  required
                />
              </div>

              {displayError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {displayError}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-2 size-4" />
                )}
                Complete Setup
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
