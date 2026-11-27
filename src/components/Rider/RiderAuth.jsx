import { useRef, useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
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
import { riderSupabase as supabase } from "../../lib/supabase";
import { riderApiRequest } from "../../lib/riderApi";

async function ensureRiderProfile(user, fullName) {
  if (!supabase || !user?.id) return;
  await riderApiRequest("/api/rider/profile", {
    method: "POST",
    body: JSON.stringify({ fullName: fullName || user.user_metadata?.full_name }),
  });
}

export default function RiderAuth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const turnstileRef = useRef(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setMessage("");
    setPassword("");
    setCaptchaToken("");
    turnstileRef.current?.reset();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    if (!turnstileSiteKey) {
      setError("Security verification is not configured. Please try again later.");
      return;
    }

    if (!captchaToken) {
      setError("Please complete the security verification.");
      return;
    }

    if (mode === "signup") {
      if (!name.trim()) {
        setError("Please enter your full name.");
        return;
      }

      const validPassword =
        password.length >= 12 &&
        /[a-z]/.test(password) &&
        /[A-Z]/.test(password) &&
        /[0-9]/.test(password) &&
        /[^A-Za-z0-9]/.test(password);

      if (!validPassword) {
        setError(
          "Use at least 12 characters, including uppercase and lowercase letters, a number and a symbol."
        );
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: name.trim(),
              role: "rider",
            },
            captchaToken,
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        if (data.session) {
          await ensureRiderProfile(data.user, name.trim());
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
            options: { captchaToken },
          });

        if (loginError) {
          throw loginError;
        }

        await ensureRiderProfile(data.user);
        onLogin(data.user);
      }
    } catch (authError) {
      setError(authError.message || "Something went wrong.");
    } finally {
      setLoading(false);
      setCaptchaToken("");
      turnstileRef.current?.reset();
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

    if (!turnstileSiteKey) {
      setError("Security verification is not configured. Please try again later.");
      return;
    }

    if (!captchaToken) {
      setError("Please complete the security verification first.");
      return;
    }

    try {
      setLoading(true);

      const redirectUrl = `${window.location.origin}${window.location.pathname}`;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: redirectUrl,
          captchaToken,
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
      setCaptchaToken("");
      turnstileRef.current?.reset();
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
                minLength={mode === "signup" ? 12 : undefined}
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

          {turnstileSiteKey ? (
            <Turnstile
              ref={turnstileRef}
              siteKey={turnstileSiteKey}
              onSuccess={setCaptchaToken}
              onExpire={() => setCaptchaToken("")}
              onError={(errorCode) => {
                setCaptchaToken("");
                console.error("Turnstile widget failed:", errorCode);
                setError(
                  `Security verification failed${errorCode ? ` (${errorCode})` : ""}. Please try again.`
                );
              }}
            />
          ) : null}

          <button
            type="submit"
            className="rider-auth-submit"
            disabled={loading || !turnstileSiteKey || !captchaToken}
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
                onClick={() => switchMode("signup")}
              >
                Create account
              </button>
            </>
          ) : (
            <>
              <span>Already have a rider account?</span>

              <button
                type="button"
                onClick={() => switchMode("login")}
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
