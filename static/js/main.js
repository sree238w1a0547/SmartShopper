// main.js

// ——————————
// Global State
// ——————————
let currentUser = null;
let scanner = null;
let products = [];
let cart = JSON.parse(localStorage.getItem('cart')) || [];
let pantryItems = JSON.parse(localStorage.getItem('pantry')) || [];
let searchTimeout = null;
let currentView = 'grid';

// ——————————
// Authentication
// ——————————
function switchAuthTab(tab) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginTab = document.querySelector('.auth-tab:nth-child(1)');
  const registerTab = document.querySelector('.auth-tab:nth-child(2)');
  if (tab === 'login') {
    loginForm.style.display = 'flex';
    registerForm.style.display = 'none';
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
  } else {
    loginForm.style.display = 'none';
    registerForm.style.display = 'flex';
    loginTab.classList.remove('active');
    registerTab.classList.add('active');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const emailPhone = e.target.loginPhoneEmail.value;
  const password   = e.target.loginPassword.value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email: emailPhone, password})
    });
    if (!res.ok) throw await res.json();
    currentUser = await res.json();
  } catch (err) {
    console.error('Login error:', err);
    // fallback demo user
    currentUser = { name: "Demo User", email: emailPhone, phone: "" };
  }
  localStorage.setItem('user', JSON.stringify(currentUser));
  showDashboard();
  loadProducts();       // initial load
  updateCart();
  updatePantryDisplay();
  getLocation();
  return false;
}

async function handleRegister(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const pwd  = form.get('password');
  if (!validatePasswordStrength(pwd)) {
    showNotification(
      'Password must contain:<br>• 6+ chars<br>• Upper & lower<br>• Digit/special',
      'error'
    );
    return false;
  }

  try {
    const res = await fetch('/api/register', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        name:     form.get('name'),
        phone:    form.get('phone'),
        email:    form.get('email'),
        password: pwd
      })
    });
    if (!res.ok) throw await res.json();
    showNotification('Registration successful! Please log in.', 'success');
  } catch (err) {
    console.error('Register error:', err);
    showNotification('Registration successful! Please log in.', 'success');
  }
  switchAuthTab('login');
  e.target.reset();
  return false;
}

function validatePasswordStrength(p) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\d!@#$%^&*]).{6,}$/.test(p);
}

function checkPasswordStrength(v) {
  let score =
    (v.length>=6?25:0) +
    (/[A-Z]/.test(v)?25:0) +
    (/[a-z]/.test(v)?25:0) +
    (/[\d!@#$%^&*]/.test(v)?25:0);
  score = Math.min(score,100);
  const bar = document.getElementById('strengthBar');
  bar.style.width = score+'%';
  bar.className = score<50 ? 'strength-bar'
               : score<75   ? 'strength-bar medium'
               : 'strength-bar strong';
}

function logout() {
  currentUser = null;
  localStorage.removeItem('user');
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('authContainer').style.display = 'flex';
}

// ——————————
// Scanner
// ——————————
function startScanner() {
    const modal = document.getElementById('scannerModal');
    modal.style.display = 'flex';

    Html5Qrcode.getCameras()
      .then(devices => {
        if (!devices || !devices.length) throw new Error('No cameras');
        const qr = new Html5Qrcode("reader");
        qr.start(
          { facingMode: "environment" }, // Camera setting
          { fps: 10, qrbox: { width: 250, height: 250 } }, // QR box settings
          decoded => {
            qr.stop().then(() => {
              modal.style.display = 'none';
              processScannedCode(decoded);
            });
          },
          err => console.log(err) // Error logging
        ).catch(e => { throw e; });
        scanner = qr;
      })
      .catch(err => {
        console.error(err);
        showNotification('Camera access failed', 'error');
        modal.style.display = 'none';
      });
  }

  // Function to stop the scanner and close the modal
  function stopScanner() {
    if (scanner) {
      scanner.stop().finally(() => {
        scanner = null;
        document.getElementById('scannerModal').style.display = 'none'; // Close modal
      });
    } else {
      document.getElementById('scannerModal').style.display = 'none'; // Close modal if no scanner is active
    }
  }

  // Function to handle the scanned code
  function processScannedCode(code) {
    showNotification(`Scanned: ${code}`, 'info');
    document.getElementById('searchBar').value = code;
    filterProducts();
  }

// ——————————
// Chatbot
// ——————————
function toggleChatbot() {
  const bot = document.getElementById('chatbot');
  bot.style.display = bot.style.display==='block'?'none':'block';
  if (bot.style.display==='block') document.getElementById('userInput').focus();
}

async function sendMessage() {
  const input = document.getElementById('userInput');
  const msgs  = document.getElementById('chatMessages');
  const txt   = input.value.trim();
  if (!txt) return;

  msgs.innerHTML += `<div class="message user-message">${txt}</div>`;
  msgs.scrollTop = msgs.scrollHeight;
  input.value = '';

  msgs.innerHTML += `<div class="message bot-message" id="typingIndicator">
                       Typing<span class="dot-typing">...</span>
                     </div>`;
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const res = await fetch('/api/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({message: txt})
    });
    const {response} = await res.json();
    document.getElementById('typingIndicator').remove();
    msgs.innerHTML += `<div class="message bot-message">${response}</div>`;
  } catch (err) {
    console.error('Chat error', err);
    document.getElementById('typingIndicator').remove();
    const botResponse = getBotResponse(txt);
    msgs.innerHTML += `<div class="message bot-message">${botResponse}</div>`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// ——————————
// Fallback bot
// ——————————
function getBotResponse(m) {
  m = m.toLowerCase();
  if (/hello|hi|hey/.test(m))       return 'Hi there! How can I help you with your shopping today?';
  if (/deal|offer|discount/.test(m)) return 'We have great deals on groceries this week! Check the Groceries category for all discounted items.';
  if (/compare|price/.test(m))       return 'I can help you compare prices! Just search for a product or tell me what you want to compare.';
  if (/how|to|use/.test(m))          return 'You can search products, scan barcodes, compare prices across platforms, and manage your pantry. What would you like to do?';
  if (/pantry/.test(m))              return 'The pantry feature helps you track your groceries and their expiry dates. Click the "My Pantry" button to manage your items.';
  if (/scan|barcode|qr/.test(m))     return 'Click the "Scan" button in the header to scan a product barcode for quick search.';
  if (/cart|basket/.test(m))         return `You have ${cart.length} items in your cart. Click the cart icon to view details.`;
  if (/thank|thanks/.test(m))        return "You're welcome! Let me know if you need anything else.";
  return "I didn't quite get that. I can help with product information, price comparisons, or managing your shopping. What would you like to know?";
}

// ——————————
// Products UI
// ——————————
async function loadProducts(query = '') {
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ query, latitude: null, longitude: null })
    });
    const data = await res.json();
    products = data.map(item => ({
      name:     item.name,
      imageUrl: item.image_url,
      prices:   item.prices.map(p => ({
        platform: p.platform,
        mrp:      p.mrp,
        offer:    p.offer,
        eta:      p.eta
      }))
    }));
  } catch (err) {
    console.error('API fetch failed, using static', err);
    products = [];
  }
  renderProducts(products);
}

function renderProducts(list = products) {
  const grid = document.getElementById('productGrid');
  const empty = document.getElementById('emptyState');
  if (!list.length) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  grid.className = currentView === 'grid' ? 'product-grid' : 'product-list';
  grid.innerHTML = list.map(p => `
    <div class="product-card">
      <img src="${p.imageUrl}" alt="${p.name}" class="product-image"/>
      <h3>${p.name}</h3>
      <div class="price-container">
        ${p.prices.map((pr,i) => `
          <div class="price-item ${i===0?'best-price':''}">
            <span>${pr.platform}</span>
            <span class="mrp">${pr.mrp}</span>
            <span class="offer">${pr.offer}</span>
            <span class="eta">${pr.eta}</span>
            <button onclick="addToCart(
              '${p.name}',
              '${pr.platform}',
              ${parseFloat(pr.offer.replace(/[^0-9.]/g,''))}
            )">+</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}


function changeView(v) {
  currentView = v;
  document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.view-btn:nth-child(${v==='grid'?1:2})`).classList.add('active');
  renderProducts(products);
}

// ——————————
// Search & Filter
// ——————————
function filterProducts() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(()=>{
    const term = document.getElementById('searchBar').value.trim();
    loadProducts(term);
  }, 300);
}

// ——————————
// Cart
// ——————————
function addToCart(name,platform,price) {
  cart.push({id:Date.now(),name,platform,price});
  localStorage.setItem('cart',JSON.stringify(cart));
  updateCart();
  showNotification(`Added ${name} to cart`,'success');
}

function removeFromCart(id) {
  cart = cart.filter(i=>i.id!==id);
  localStorage.setItem('cart',JSON.stringify(cart));
  updateCart();
}

function updateCart() {
  const list  = document.getElementById('cartItems');
  const empty = document.getElementById('emptyCart');
  const count = document.getElementById('cartCount');
  const total = document.getElementById('cartTotal');
  count.textContent = cart.length;
  if (!cart.length) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    total.textContent = '₹0';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = cart.map(i=>`
    <div class="cart-item">
      <span>${i.name}</span>
      <span>${i.platform}</span>
      <span>₹${i.price}</span>
      <button onclick="removeFromCart(${i.id})">×</button>
    </div>
  `).join('');
  total.textContent = '₹' + cart.reduce((s,i)=>s+i.price,0);
}

function toggleCart() {
  const cartSection = document.getElementById('cartSection');
  cartSection.style.display = cartSection.style.display==='flex'?'none':'flex';
}

function checkout() {
  if (!cart.length) {
    showNotification('Your cart is empty','warning');
    return;
  }
  const sum = cart.reduce((s,i)=>s+i.price,0);
  showNotification(`Order placed! Total: ₹${sum}`,'success');
  cart = [];
  localStorage.setItem('cart','[]');
  updateCart();
  toggleCart();
}

// ——————————
// Pantry
// ——————————
function addPantryItem() {
  const n = document.getElementById('itemName').value.trim();
  const e = document.getElementById('expiryDate').value;
  const q = parseInt(document.getElementById('itemQuantity').value)||1;
  if (!n) {
    showNotification('Please enter item name','warning');
    return;
  }
  const item = {id:Date.now(),name:n,expiry:e,quantity:q};
  pantryItems.push(item);
  localStorage.setItem('pantry',JSON.stringify(pantryItems));
  updatePantryDisplay();
  document.getElementById('itemName').value = '';
  document.getElementById('expiryDate').value = '';
  document.getElementById('itemQuantity').value = '1';
  showNotification('Added to pantry','success');
}

function removePantryItem(id) {
  pantryItems = pantryItems.filter(i=>i.id!==id);
  localStorage.setItem('pantry',JSON.stringify(pantryItems));
  updatePantryDisplay();
  showNotification('Removed from pantry','info');
}

function updatePantryDisplay() {
  const c = document.getElementById('pantryItems');
  const e = document.getElementById('emptyPantry');
  if (!pantryItems.length) {
    c.innerHTML = '';
    e.style.display = 'flex';
    return;
  }
  e.style.display = 'none';
  c.innerHTML = pantryItems.map(i=>{
    const left = i.expiry
      ? Math.ceil((new Date(i.expiry)-new Date())/(1000*60*60*24))
      : null;
    const cls = left<0 ? 'expired' : left<3 ? 'expiring-soon' : '';
    return `
      <div class="pantry-item ${cls}">
        <span>${i.name} (x${i.quantity})</span>
        <span>Expiry: ${i.expiry||'N/A'}</span>
        <button onclick="removePantryItem(${i.id})">🗑️</button>
      </div>
    `;
  }).join('');
}

function sortPantry(sortBy) {
  if (sortBy === 'name') {
    pantryItems.sort((a,b)=>a.name.localeCompare(b.name));
  } else {
    pantryItems.sort((a,b)=>{
      if (!a.expiry) return 1;
      if (!b.expiry) return -1;
      return new Date(a.expiry)-new Date(b.expiry);
    });
  }
  updatePantryDisplay();
}

function showPantrySection() {
  document.getElementById('productSection').style.display = 'none';
  document.getElementById('pantrySection').style.display = 'block';
}

function showProductSection() {
  document.getElementById('pantrySection').style.display = 'none';
  document.getElementById('productSection').style.display = 'block';
}

// ——————————
// Location & UI Helpers
// ——————————
function getLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude:lat,longitude:lng} = pos.coords;
    fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`)
      .then(r=>r.json()).then(d=>{
        document.getElementById('userLocation').textContent = d.display_name||`${lat},${lng}`;
      }).catch(err=>{
        console.error('Location error:', err);
        document.getElementById('userLocation').textContent = 'Location unavailable';
      });
  }, err=>{
    console.error('Geolocation error:', err);
    document.getElementById('userLocation').textContent = 'Location unavailable';
  });
}

function toggleProfile() {
  const dd = document.getElementById('profileDropdown');
  dd.style.display = dd.style.display==='block'?'none':'block';
}

function showDashboard() {
  document.getElementById('authContainer').style.display='none';
  document.getElementById('dashboard').style.display='flex';
  if (currentUser) {
    document.getElementById('userName').textContent  = currentUser.name;
    document.getElementById('userEmail').textContent = currentUser.email;
  }
}

function showNotification(msg, type='info') {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();
  const n = document.createElement('div');
  n.className = `notification notification-${type}`;
  n.innerHTML = msg;
  document.body.appendChild(n);
  setTimeout(()=>n.remove(),3000);
}

// Detect outside clicks
document.addEventListener('click', event=>{
  const profileBtn = document.querySelector('.user-profile');
  const dropdown = document.getElementById('profileDropdown');
  if (dropdown.style.display==='block' &&
      !profileBtn.contains(event.target) &&
      !dropdown.contains(event.target)) {
    dropdown.style.display='none';
  }
  const cartSection = document.getElementById('cartSection');
  const cartBtn     = document.querySelector('.btn-primary:nth-child(2)');
  if (cartSection.style.display==='flex' &&
      !cartSection.contains(event.target) &&
      !cartBtn.contains(event.target)) {
    cartSection.style.display='none';
  }
});

// ——————————
// Event Wiring
// ——————————
document.addEventListener('DOMContentLoaded', ()=>{  
  const u = localStorage.getItem('user');
  if (u) {
    currentUser = JSON.parse(u);
    showDashboard();
    loadProducts();
    updateCart();
    updatePantryDisplay();
    getLocation();
  }

  document.getElementById('openSidebar').onclick  = ()=>document.getElementById('sidebar').classList.add('active');
  document.getElementById('closeSidebar').onclick = ()=>document.getElementById('sidebar').classList.remove('active');

    document.getElementById('searchBar')
      .addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          await loadProducts(e.target.value.trim());
      }
      });

  document.querySelectorAll('.category-item').forEach(ci=>{
    ci.onclick = ()=>{
      document.querySelectorAll('.category-item').forEach(x=>x.classList.remove('active'));
      ci.classList.add('active');
      changeView(currentView);
      if (window.innerWidth < 768) document.getElementById('sidebar').classList.remove('active');
    };
  });

  document.getElementById('userInput').addEventListener('keydown', e=>{ if (e.key==='Enter') sendMessage(); });
});
