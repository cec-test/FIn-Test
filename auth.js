/**
 * Telescope Auth System
 * Simple localStorage-based authentication for demo/prototype
 */

const ADMIN_CODE = 'Tel3scope!';

// Check if already logged in (redirect to dashboard)
window.addEventListener('DOMContentLoaded', function() {
    const user = getCurrentUser();
    if (user) {
        window.location.href = 'index.html';
    }
});

function getCurrentUser() {
    try {
        const userStr = localStorage.getItem('telescopeUser');
        return userStr ? JSON.parse(userStr) : null;
    } catch (e) {
        return null;
    }
}

function showMessage(message, type = 'error') {
    // Remove existing messages
    const existing = document.querySelector('.message');
    if (existing) {
        existing.remove();
    }
    
    // Create new message
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    msg.textContent = message;
    
    // Insert at top of active form
    const activeForm = document.querySelector('.auth-form:not([style*="display: none"])');
    if (activeForm) {
        activeForm.insertBefore(msg, activeForm.firstChild);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            msg.style.opacity = '0';
            setTimeout(() => msg.remove(), 300);
        }, 5000);
    }
}

function handleSignIn() {
    const email = document.getElementById('signInEmail').value.trim();
    const password = document.getElementById('signInPassword').value;
    
    if (!email || !password) {
        showMessage('Please enter both email and password');
        return;
    }
    
    if (!isValidEmail(email)) {
        showMessage('Please enter a valid email address');
        return;
    }
    
    // Check if user exists in localStorage
    const users = getAllUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
        showMessage('Account not found. Please create an account first.');
        return;
    }
    
    if (user.password !== password) {
        showMessage('Incorrect password');
        return;
    }
    
    // Set current user and redirect
    setCurrentUser(user);
    showMessage('Welcome back! Redirecting...', 'success');
    
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
}

function handleSignUp() {
    const name = document.getElementById('signUpName').value.trim();
    const email = document.getElementById('signUpEmail').value.trim();
    const password = document.getElementById('signUpPassword').value;
    
    if (!name || !email || !password) {
        showMessage('Please fill in all fields');
        return;
    }
    
    if (!isValidEmail(email)) {
        showMessage('Please enter a valid email address');
        return;
    }
    
    if (password.length < 6) {
        showMessage('Password must be at least 6 characters');
        return;
    }
    
    // Check if user already exists
    const users = getAllUsers();
    const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (existingUser) {
        showMessage('An account with this email already exists');
        return;
    }
    
    // Create new user (beta role by default)
    const newUser = {
        id: Date.now().toString(),
        name: name,
        email: email,
        password: password, // In production, this would be hashed
        role: 'beta',
        createdAt: new Date().toISOString()
    };
    
    // Save to users list
    users.push(newUser);
    localStorage.setItem('telescopeUsers', JSON.stringify(users));
    
    // Set as current user and redirect
    setCurrentUser(newUser);
    showMessage('Account created! Redirecting...', 'success');
    
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
}

function handleAdminCode() {
    const code = document.getElementById('adminCode').value;
    
    if (!code) {
        showMessage('Please enter the access code');
        return;
    }
    
    if (code !== ADMIN_CODE) {
        showMessage('Invalid access code');
        document.getElementById('adminCode').value = '';
        return;
    }
    
    // Create admin user
    const adminUser = {
        id: 'admin',
        name: 'Admin',
        email: 'admin@telescope.com',
        role: 'admin',
        createdAt: new Date().toISOString()
    };
    
    // Set as current user and redirect
    setCurrentUser(adminUser);
    showMessage('Admin access granted! Redirecting...', 'success');
    
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
}

function setCurrentUser(user) {
    // Remove password before storing (security)
    const userToStore = { ...user };
    delete userToStore.password;
    
    localStorage.setItem('telescopeUser', JSON.stringify(userToStore));
}

function getAllUsers() {
    try {
        const usersStr = localStorage.getItem('telescopeUsers');
        return usersStr ? JSON.parse(usersStr) : [];
    } catch (e) {
        return [];
    }
}

function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getCurrentUser,
        setCurrentUser,
        ADMIN_CODE
    };
}
