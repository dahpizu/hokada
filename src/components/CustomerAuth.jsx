import { useEffect, useState } from "react";
import { ArrowRight, Bike, Lock, Mail, Phone, User } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function CustomerAuth({ onAuthenticated }) {
  const [mode, setMode] = useState("login");

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

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
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

        const { error: profileError } = await supabase
          .from("customer_profiles")
          .upsert({
            id: data.user.id,
            full_name: fullName.trim(),
            phone: phone.trim(),
            updated_at: new Date().toISOString(),
          });

        if (profileError) {
          console.error("Could not create customer profile:", profileError);
        }

        onAuthenticated(data.user);
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        throw error;
      }

      if (!data.user) {
        throw new Error("Login failed.");
      }

      onAuthenticated(data.user);
    } catch (error) {
      console.error("Customer authentication error:", error);

      setErrorMessage(
        error?.message || "Authentication failed. Please try again."
      );
    } finally {
      setLoading(false);
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
                  placeholder="At least 6 characters"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
              </div>
            </div>

            <button
              type="submit"
              className="primary-button full-width auth-submit"
              disabled={loading}
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
