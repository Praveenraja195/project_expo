const API = window.location.origin.includes('127.0.0.1') || window.location.origin.includes('localhost') 
    ? "http://127.0.0.1:5000" 
    : window.location.origin;
let currentRole = null;
let profile = null;

// --- DOM ELEMENTS ---
const sections = {
    landing: document.getElementById('section-landing'),
    login: document.getElementById('section-login'),
    student: document.getElementById('section-student'),
    staff: document.getElementById('section-staff')
};

const overlays = {
    hero: document.getElementById('bg-hero'),
    login: document.getElementById('bg-login'),
    student: document.getElementById('bg-student'),
    staff: document.getElementById('bg-staff')
};

// --- NAVIGATION ---
function showView(viewId) {
    // Hide all
    Object.values(sections).forEach(s => s.classList.add('hidden'));
    Object.values(overlays).forEach(o => o.classList.add('hidden'));
    
    // Show target section
    sections[viewId].classList.remove('hidden');
    
    // Background management
    if(viewId === 'landing') {
        overlays.hero.classList.remove('hidden');
    } else if(viewId === 'login') {
        overlays.login.classList.remove('hidden');
    } else if(viewId === 'student') {
        overlays.student.classList.remove('hidden');
    } else if(viewId === 'staff') {
        overlays.staff.classList.remove('hidden');
    }
    
    window.scrollTo(0, 0);
}

function initPortal(role) {
    currentRole = role;
    document.getElementById('portal-select').classList.add('hidden');
    document.getElementById('auth-form').classList.remove('hidden');
    
    const title = document.getElementById('login-title');
    const hint = document.getElementById('login-hint');
    const idLabel = document.getElementById('login-id-label');
    const passLabel = document.getElementById('login-pass-label');
    const idInput = document.getElementById('login-id');
    const passInput = document.getElementById('login-pass');

    if(role === 'student') {
        title.innerText = 'Student Link';
        hint.innerText = 'Required: Registration ID & DOB';
        idLabel.innerText = 'Registration ID';
        idInput.placeholder = 'Enter ID...';
        passLabel.innerText = 'DOB (Access Key)';
        passInput.placeholder = '10-01-2005';
    } else {
        title.innerText = 'Faculty Key';
        hint.innerText = 'Required: Staff Name & Password';
        idLabel.innerText = 'Staff Name';
        idInput.placeholder = 'Enter Staff Name...';
        passLabel.innerText = 'Password';
        passInput.placeholder = 'Enter Password...';
    }
}

function resetPortal() {
    currentRole = null;
    document.getElementById('portal-select').classList.remove('hidden');
    document.getElementById('auth-form').classList.add('hidden');
    document.getElementById('login-title').innerText = 'System Entry';
    document.getElementById('login-id').value = '';
    document.getElementById('login-pass').value = '';
}

function goHome() {
    resetPortal();
    showView('landing');
}

// --- AUTHENTICATION ---
async function handleLogin() {
    const id = document.getElementById('login-id').value.trim();
    const pass = document.getElementById('login-pass').value.trim();

    if(!id || !pass) return alert("System requires full credentials.");

    if(currentRole === 'staff') {
        if(id === 'vasuki' && pass === 'classadviser') {
            profile = {
                name: "Mrs.N.Vasuki",
                title: "Assistant Professor, Dept. Of CSE, IRTT",
                qualification: "M.E",
                experience: "15 Years",
                specialization: "Operating System, System Software, Computer Networks",
                conference: "2",
                contact: "+91-424-2533279-113, +91-424-2533279-117",
                email: "vasuki@irttech.ac.in",
                staff_id: id
            };
            setupStaffDashboard();
            showView('staff');
        } else if(pass === 'admin') {
            profile = { 
                name: "System Admin", 
                title: "University Administrator",
                qualification: "N/A",
                experience: "N/A",
                specialization: "System Management",
                conference: "N/A",
                contact: "admin@irttech.ac.in",
                email: "admin@irttech.ac.in",
                staff_id: "admin" 
            };
            setupStaffDashboard();
            showView('staff');
        } else {
            alert("Entry Denied: Invalid Faculty Key.");
        }
        return;
    }

    try {
        const res = await fetch(`${API}/student/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reg_no: id, password: pass })
        });
        const data = await res.json();
        if(data.status === 'success') {
            profile = data.profile;
            setupDashboard();
            showView('student');
        } else {
            alert(data.message);
        }
    } catch(e) {
        alert("Fatal Error: Neural Link Timeout.");
    }
}

function setupDashboard() {
    const name = profile.name || "Student";
    document.getElementById('stu-name').innerText = name;
    document.getElementById('stu-initial').innerText = name.charAt(0);
    document.getElementById('stu-dept').innerText = `${profile.year} • ${profile.dept}`;
    document.getElementById('val-cgpa').innerText = profile.cgpa;
    document.getElementById('val-att').innerText = profile.attendance + '%';
    document.getElementById('val-proj').innerText = profile.projects.padStart(2, '0');
    document.getElementById('rec-id').innerText = profile.reg_no;
    document.getElementById('rec-email').innerText = profile.email;

    // Photo Loading
    loadStudentPhoto(profile.reg_no);

    // New Data Populating
    document.getElementById('val-skills').innerText = profile.skills || "No skills recorded.";
    document.getElementById('val-goal').innerText = profile.career_goal || "General Academic Success";
    document.getElementById('val-aptitude').innerText = profile.aptitude_score || "N/A";
    document.getElementById('val-interview').innerText = profile.interview_rating || "N/A";
    document.getElementById('val-arrears').innerText = profile.arrears || "0";

    // GPA Progression Logic
    const timeline = document.getElementById('gpa-timeline');
    timeline.innerHTML = '';
    if(profile.gpa_history) {
        Object.entries(profile.gpa_history).forEach(([sem, gpa]) => {
            const item = document.createElement('div');
            item.style.textAlign = 'center';
            item.style.flex = '1';
            item.innerHTML = `
                <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px">${sem}</div>
                <div style="font-weight:600; color:var(--primary)">${gpa || '--'}</div>
            `;
            timeline.appendChild(item);
        });
    }
}

function setupStaffDashboard() {
    if(!profile) return;
    document.getElementById('staff-name').innerText = profile.name;
    document.getElementById('staff-title').innerText = profile.title;
    document.getElementById('staff-qual').innerText = profile.qualification;
    document.getElementById('staff-exp').innerText = profile.experience;
    document.getElementById('staff-spec').innerText = profile.specialization;
    document.getElementById('staff-conf').innerText = profile.conference;
    document.getElementById('staff-contact').innerText = profile.contact;
    document.getElementById('staff-email').innerText = profile.email;
    document.getElementById('staff-initial').innerText = profile.name.charAt(0);

    // Photo Loading
    loadStaffPhoto(profile.staff_id || profile.name.toLowerCase().split(' ')[0]);
}

function loadStaffPhoto(staffId) {
    if (!staffId) return;
    staffId = staffId.trim().toLowerCase();
    const photo = document.getElementById('staff-photo');
    const initial = document.getElementById('staff-initial');
    const formats = ['jpg', 'png', 'jpeg', 'webp'];
    let index = 0;

    const tryNext = () => {
        if (index < formats.length) {
            const ext = formats[index++];
            const fullPath = `${API}/static/staff_photos/${staffId}.${ext}`;
            console.log(`[System] Attempting to load staff photo: ${fullPath}`);
            photo.src = fullPath;
        } else {
            console.warn(`[System] No photo found for staff ${staffId} in any known format.`);
            photo.style.display = 'none';
            initial.style.display = 'flex';
        }
    };

    photo.onload = () => {
        console.log(`[System] Staff photo loaded successfully for ${staffId}`);
        photo.style.display = 'block';
        initial.style.display = 'none';
    };

    photo.onerror = tryNext;
    tryNext();
}

function loadStudentPhoto(regNo) {
    if (!regNo) return;
    regNo = regNo.trim();
    const photo = document.getElementById('stu-photo');
    const initial = document.getElementById('stu-initial');
    const formats = ['jpg', 'png', 'jpeg', 'webp'];
    let index = 0;

    const tryNext = () => {
        if (index < formats.length) {
            const ext = formats[index++];
            const fullPath = `${API}/static/student_photos/${regNo}.${ext}`;
            console.log(`[System] Attempting to load student photo: ${fullPath}`);
            photo.src = fullPath;
        } else {
            console.warn(`[System] No photo found for student ${regNo} in any known format.`);
            photo.style.display = 'none';
            initial.style.display = 'flex';
        }
    };

    photo.onload = () => {
        console.log(`[System] Student photo loaded successfully for ${regNo}`);
        photo.style.display = 'block';
        initial.style.display = 'none';
    };

    photo.onerror = tryNext;
    tryNext();
}

// --- CHAT SYSTEM ---
async function sendQuery(role) {
    const inputId = role === 'student' ? 'stu-input' : 'staff-input';
    const boxId = role === 'student' ? 'stu-chat-box' : 'staff-chat-box';
    const input = document.getElementById(inputId);
    const box = document.getElementById(boxId);
    const text = input.value.trim();

    if(!text) return;

    addMsg(box, text, 'msg-user');
    input.value = '';

    const endpoint = role === 'student' ? '/student/chat' : '/chat';
    const body = role === 'student' ? { reg_no: profile.reg_no, message: text } : { message: text };

    try {
        const res = await fetch(`${API}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if(data.type === 'chart') {
            addMsg(box, data.reply || "Analysis Complete.", 'msg-ai');
            renderChart(box, data.chart_data);
        } else {
            addMsg(box, data.reply || data.message || "Logic Error.", 'msg-ai');
        }
    } catch(e) {
        addMsg(box, "Fatal Error: Stream Interrupted.", 'msg-ai');
    }
}

function addMsg(box, text, cls) {
    const d = document.createElement('div');
    d.className = `msg ${cls}`;
    d.innerText = text;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
}

function renderChart(box, data) {
    const wrap = document.createElement('div');
    wrap.className = 'bento-card';
    wrap.style.height = '300px';
    wrap.style.marginTop = '10px';
    wrap.innerHTML = `<canvas></canvas>`;
    box.appendChild(wrap);
    
    new Chart(wrap.querySelector('canvas'), {
        type: data.chart_type,
        data: {
            labels: data.labels,
            datasets: [{
                label: data.title,
                data: data.data,
                backgroundColor: ['#818cf8', '#c084fc', '#22d3ee', '#f472b6', '#fbbf24'],
                borderWidth: 0,
                borderRadius: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { labels: { color: '#a1a1aa', font: { family: 'Outfit', size: 12 } } }
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#a1a1aa' } },
                x: { grid: { display: false }, ticks: { color: '#a1a1aa' } }
            }
        }
    });
    box.scrollTop = box.scrollHeight;
}

// Ensure icons load
document.addEventListener('DOMContentLoaded', () => {
    if(window.lucide) lucide.createIcons();
});
