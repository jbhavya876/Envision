import React, { useState } from "react";

function AuthForm({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const endpoint = isRegistering ? "/api/register" : "/api/login";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      if (isRegistering) {
        // Registration successful → auto login
        const loginRes = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ username, password }),
        });
        const loginData = await loginRes.json();
        if (!loginRes.ok) {
          setError(loginData.error);
          return;
        }
        onLogin(loginData.username, loginData.balance);
      } else {
        onLogin(data.username, data.balance);
      }
    } catch (err) {
      setError("Network error");
    }
  };

  return (
    <div className="auth-form">
      <h2>{isRegistering ? "Register" : "Login"}</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit">{isRegistering ? "Register" : "Login"}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <p>
        <button
          className="link-button"
          onClick={() => setIsRegistering(!isRegistering)}
        >
          {isRegistering ? "Already have an account? Login" : "New? Register"}
        </button>
      </p>
    </div>
  );
}

export default AuthForm;