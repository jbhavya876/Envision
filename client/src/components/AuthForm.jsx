import React, { useState } from 'react';

const AuthForm = ({ onLogin }) => {
    const [isRegister, setIsRegister] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        
        const endpoint = isRegister ? '/api/register' : '/api/login';
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        
        if (data.error) {
            setError(data.error);
        } else {
            if (isRegister) {
                setIsRegister(false);
                setError("Registration successful! Please login.");
            } else {
                // Success! Pass token up to App
                onLogin(data.token, data.username);
            }
        }
    };

    return (
        <div className="container-box" style={{ maxWidth: '300px', margin: '50px auto' }}>
            <h2>{isRegister ? 'Register' : 'Login'}</h2>
            <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: '10px' }}>
                    <label>Username</label>
                    <input type="text" value={username} onChange={e => setUsername(e.target.value)} required />
                </div>
                <div style={{ marginBottom: '10px' }}>
                    <label>Password</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                </div>
                {error && <p className="loss" style={{ fontSize: '0.8rem' }}>{error}</p>}
                <button type="submit" className="btn-over" style={{ width: '100%' }}>
                    {isRegister ? 'Sign Up' : 'Log In'}
                </button>
            </form>
            <p style={{ fontSize: '0.8rem', marginTop: '10px', cursor: 'pointer', color: '#b1bad3' }} 
               onClick={() => setIsRegister(!isRegister)}>
                {isRegister ? "Already have an account? Login" : "Need an account? Register"}
            </p>
        </div>
    );
};

export default AuthForm;