import { useState } from "react";
import {
  Bike,
  Lock,
  Mail,
  User,
  ArrowRight,
  Eye,
  EyeOff,
  ArrowLeft,
} from "lucide-react";
import { supabase } from "../../lib/supabase";

export default function RiderAuth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    setLoading(true);
    setError("");
    setMessage("");

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    try {
      if (mode === "signup") {
        if (!name.trim()) {
          setError("Please enter your full name.");
          setLoading(false);
          return;
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: name.trim(),
              role: "rider",
            },
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        if (data.user) {
          const { error: profileError } = await supabase
            .from("rider_profiles")
            .upsert({
              id: data.user.id,
              full_name: name.trim(),
              rating: 5.0,
              total_deliveries: 0,
              total_earnings: 0,
              is_online: false,
            });

          if (profileError) {
            throw profileError;
          }
        }

        if (data.session) {
          onLogin(data.user);
        } else {
          setMessage(
            "Account created. Please check your email to confirm your account."
          );
        }
      } else {
        const { data, error: loginError } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

        if (loginError) {
          throw loginError;
        }

        onLogin(data.user);
      }
    } catch (authError) {
      setError(authError.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError("");
    setMessage("");

    if (!email.trim()) {
      setError("Please enter your email address first.");
      return;
    }

    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    try {
      setLoading(true);

      const redirectUrl = `${window.location.origin}${window.location.pathname}`;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: redirectUrl,
        }
      );

      if (resetError) {
        throw resetError;
      }

      setMessage(
        "Password reset link sent. Check your email and follow the link to create a new password."
      );
    } catch (resetError) {
      setError(
        resetError.message || "Could not send the password reset email."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rider-auth-page">
      <div className="rider-auth-card">
        <div className="rider-auth-logo">
          <Bike size={30} />
        </div>

        <div className="rider-auth-header">
          <span className="eyebrow">HOKADA RIDER</span>

          <h1>{mode === "login" ? "Welcome back" : "Become a HOKADA rider"}</h1>

          <p>
            {mode === "login"
              ? "Sign in to manage your deliveries."
              : "Create your rider account and start accepting deliveries."}
          </p>
        </div>

        {error && <div className="rider-auth-error">{error}</div>}

        {message && <div className="rider-auth-message">{message}</div>}

        <form onSubmit={handleSubmit}>
          {mode === "signup" && (
            <div className="rider-auth-field">
              <label>Full name</label>

              <div className="rider-auth-input">
                <User size={18} />

                <input
                  type="text"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div className="rider-auth-field">
            <label>Email address</label>

            <div className="rider-auth-input">
              <Mail size={18} />

              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="rider-auth-field">
            <div className="rider-auth-label-row">
              <label>Password</label>

              {mode === "login" && (
                <button
                  type="button"
                  className="rider-forgot-button"
                  onClick={handleForgotPassword}
                  disabled={loading}
                >
                  Forgot password?
                </button>
              )}
            </div>

            <div className="rider-auth-input">
              <Lock size={18} />

              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />

              <button
                type="button"
                className="rider-password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="rider-auth-submit"
            disabled={loading}
          >
            {loading
              ? "Please wait..."
              : mode === "login"
              ? "Sign in"
              : "Create rider account"}

            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

        <div className="rider-auth-switch">
          {mode === "login" ? (
            <>
              <span>Don't have a rider account?</span>

              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setMessage("");
                  setPassword("");
                }}
              >
                Create account
              </button>
            </>
          ) : (
            <>
              <span>Already have a rider account?</span>

              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError("");
                  setMessage("");
                  setPassword("");
                }}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
