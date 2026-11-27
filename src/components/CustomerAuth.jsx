import { useEffect, useRef, useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { ArrowRight, Bike, Lock, Mail, Phone, User } from "lucide-react";
import { supabase } from "../lib/supabase";

async function ensureCustomerProfile(user, fullName, phone) {
  if (!supabase || !user?.id) return;

  const { data: profile, error: readError } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (readError) throw readError;
  if (profile || !phone) return;

  const { error: insertError } = await supabase
    .from("customer_profiles")
    .insert({
      id: user.id,
      full_name: fullName || user.user_metadata?.full_name || "",
      phone,
      updated_at: new Date().toISOString(),
    });

  if (insertError) throw insertError;
}

export default function CustomerAuth({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const turnstileRef = useRef(null);
  const [captchaToken, setCaptchaToken] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      if (!supabase) {
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user && mounted) {
        onAuthenticated(session.user);
      }
    }

    checkSession();

    return () => {
      mounted = false;
    };
  }, [onAuthenticated]);

  function switchMode(nextMode) {
    setMode(nextMode);
    setErrorMessage("");
    setSuccessMessage("");
    setCaptchaToken("");
    turnstileRef.current?.reset();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!supabase) {
      setErrorMessage("HOKADA could not connect to Supabase.");
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");

    if (!email.trim() || !password) {
      setErrorMessage("Please enter your email and password.");
      return;
    }

    if (mode === "signup" && !fullName.trim()) {
      setErrorMessage("Please enter your full name.");
      return;
    }

    if (mode === "signup" && !phone.trim()) {
      setErrorMessage("Please enter your phone number.");
      return;
    }

    if (mode === "signup") {
      const validPassword =
        password.length >= 12 &&
        /[a-z]/.test(password) &&
        /[A-Z]/.test(password) &&
        /[0-9]/.test(password) &&
        /[^A-Za-z0-9]/.test(password);

      if (!validPassword) {
        setErrorMessage(
          "Use at least 12 characters, including uppercase and lowercase letters, a number and a symbol."
        );
        return;
      }
    }

    if (!turnstileSiteKey) {
      setErrorMessage("Security verification is not configured. Please try again later.");
      return;
    }

    if (!captchaToken) {
      setErrorMessage("Please complete the security verification.");
      return;
    }

    try {
      setLoading(true);

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
            data: { full_name: fullName.trim(), phone: phone.trim() },
            captchaToken,
          },
        });

        if (error) {
          throw error;
        }

        if (!data.user) {
          throw new Error("Account could not be created.");
        }

        /*
         * If Supabase requires email confirmation,
         * session may be null immediately after signup.
         */
        if (!data.session) {
          setSuccessMessage(
            "Account created. Please check your email to confirm your account, then log in."
          );

          setMode("login");
          setPassword("");
          return;
        }

        await ensureCustomerProfile(data.user, fullName.trim(), phone.trim());

        onAuthenticated(data.user);
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
        options: { captchaToken },
      });

      if (error) {
        throw error;
      }

      if (!data.user) {
        throw new Error("Login failed.");
      }

      try {
        await ensureCustomerProfile(
          data.user,
          data.user.user_metadata?.full_name || "",
          data.user.user_metadata?.phone || ""
        );
      } catch (profileError) {
        console.error("Could not create customer profile:", profileError);
      }

      onAuthenticated(data.user);
    } catch (error) {
      console.error("Customer authentication error:", error);

      setErrorMessage(
        error?.message || "Authentication failed. Please try again."
      );
    } finally {
      setLoading(false);
      setCaptchaToken("");
      turnstileRef.current?.reset();
    }
  }

  return (
    <div className="app-shell auth-shell">
      <main className="auth-page">
        <div className="auth-brand">
          <div className="brand-icon">
            <Bike size={26} />
          </div>

          <div className="brand-text">
            <span>HOKADA</span>
            <small>FAST. SAFE. DELIVERED.</small>
          </div>
        </div>

        <section className="auth-card">
          <div className="auth-card-header">
            <span className="eyebrow">
              {mode === "login" ? "WELCOME BACK" : "JOIN HOKADA"}
            </span>

            <h1>
              {mode === "login" ? "Welcome back." : "Create your account."}
            </h1>

            <p>
              {mode === "login"
                ? "Log in to book riders and track your deliveries."
                : "Create your HOKADA account to manage your deliveries."}
            </p>
          </div>

          {errorMessage && (
            <div className="auth-message error">{errorMessage}</div>
          )}

          {successMessage && (
            <div className="auth-message success">{successMessage}</div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            {mode === "signup" && (
              <>
                <div className="form-section">
                  <label>Full name</label>

                  <div className="input-with-icon">
                    <User size={19} />

                    <input
                      type="text"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Your full name"
                      autoComplete="name"
                    />
                  </div>
                </div>

                <div className="form-section">
                  <label>Phone number</label>

                  <div className="input-with-icon">
                    <Phone size={19} />

                    <input
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="080..."
                      autoComplete="tel"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="form-section">
              <label>Email address</label>

              <div className="input-with-icon">
                <Mail size={19} />

                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="form-section">
              <label>Password</label>

              <div className="input-with-icon">
                <Lock size={19} />

                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "signup" ? "At least 12 characters" : "Enter your password"}
                  minLength={mode === "signup" ? 12 : undefined}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
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
                setErrorMessage(
                  `Security verification failed${errorCode ? ` (${errorCode})` : ""}. Please try again.`
                );
              }}
            />
) : null}

            <button
              type="submit"
              className="primary-button full-width auth-submit"
              disabled={loading || !turnstileSiteKey || !captchaToken}
            >
              {loading
                ? "Please wait..."
                : mode === "login"
                ? "Log in"
                : "Create account"}

              <ArrowRight size={19} />
            </button>
          </form>

          <div className="auth-switch">
            <span>
              {mode === "login"
                ? "Don't have a HOKADA account?"
                : "Already have a HOKADA account?"}
            </span>

            <button
              type="button"
              onClick={() => switchMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? "Create account" : "Log in"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
