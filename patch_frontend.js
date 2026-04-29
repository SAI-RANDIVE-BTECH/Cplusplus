const fs = require('fs');
let f = fs.readFileSync('frontend/app.js', 'utf8');

// Find and remove broken end
const loginStart = f.indexOf('// ============= LOGIN =============');
if (loginStart > 0) {
  f = f.substring(0, loginStart).trimEnd();
}

// Add all missing closing braces/functions
f += `

  closeModal(){document.getElementById('modal').style.display='none';document.getElementById('modal-overlay').style.display='none';},

  renderLogin(){
    const c=document.getElementById("app");
    c.innerHTML='<div class="login-container"><div class="login-box"><img src="/assets/%E0%A4%85%E0%A4%95%E0%A5%8D%E0%A4%B7%E0%A4%AF.svg" class="logo-image login-logo"><h2>Restaurant Management</h2><div class="form-tabs"><button class="tab-btn active" onclick="App.showLoginForm()">Login</button><button class="tab-btn" onclick="App.showRegisterForm()">Register</button></div><div id="login-form" class="form-content"><form onsubmit="event.preventDefault();App.handleLogin()"><div class="form-group"><label>Username</label><input type="text" id="login-username" placeholder="Username" required></div><div class="form-group"><label>Password</label><input type="password" id="login-password" placeholder="Password" required></div><button type="submit" class="btn-primary btn-large">Login</button></form><div style="margin-top:15px;font-size:12px;color:#666;"><p><strong>Demo logins:</strong></p><p>Owner: apurva / SaiBaba</p><p>Manager: shripad_deshpande / staff@2024</p><p>Waiter: parth_sahasrabuddhe / staff@2024</p><p>Customer: rajesh_kumar / customer@2024</p></div></div><div id="register-form" class="form-content" style="display:none"><form onsubmit="event.preventDefault();App.handleRegister()"><div class="form-group"><label>Full Name</label><input type="text" id="reg-name" required></div><div class="form-group"><label>Username</label><input type="text" id="reg-user" required></div><div class="form-group"><label>Email</label><input type="email" id="reg-email" required></div><div class="form-group"><label>Phone</label><input type="text" id="reg-phone"></div><div class="form-group"><label>Password</label><input type="password" id="reg-pass" required></div><div class="form-group"><label>Account Type</label><select id="reg-role" onchange="App.toggleSecretKey()"><option value="customer">Customer</option><option value="waiter">Waiter</option><option value="manager">Manager</option><option value="owner">Owner</option></select></div><div class="form-group" id="secret-key-group" style="display:none"><label>Owner Secret Key</label><input type="password" id="reg-secret" placeholder="Enter secret key"></div><button type="submit" class="btn-primary btn-large">Register</button></form></div></div></div>';
  },

  showLoginForm(){document.getElementById("login-form").style.display="block";document.getElementById("register-form").style.display="none";document.querySelectorAll(".tab-btn")[0].classList.add("active");document.querySelectorAll(".tab-btn")[1].classList.remove("active");},
  showRegisterForm(){document.getElementById("login-form").style.display="none";document.getElementById("register-form").style.display="block";document.querySelectorAll(".tab-btn")[0].classList.remove("active");document.querySelectorAll(".tab-btn")[1].classList.add("active");},
  toggleSecretKey(){const role=document.getElementById('reg-role').value;document.getElementById('secret-key-group').style.display=role==='owner'?'block':'none';},

  async handleLogin(){try{const u=document.getElementById('login-username').value;const p=document.getElementById('login-password').value;await this.login(u,p);}catch(err){alert('Login failed: '+err.message);}},
  async handleRegister(){try{const n=document.getElementById('reg-name').value;const u=document.getElementById('reg-user').value;const e=document.getElementById('reg-email').value;const p=document.getElementById('reg-phone').value;const pa=document.getElementById('reg-pass').value;const r=document.getElementById('reg-role').value;const s=document.getElementById('reg-secret').value;await this.register(u,pa,n,e,p,r,s);}catch(err){alert('Registration failed: '+err.message);}}
};

document.addEventListener("DOMContentLoaded",()=>{App.boot();});
`;

fs.writeFileSync('frontend/app.js', f);
console.log('Patched frontend/app.js successfully');

