const API = window.location.origin.includes('127.0.0.1') || window.location.origin.includes('localhost') 
    ? "http://127.0.0.1:5000" 
    : window.location.origin;
let currentRole = null;
let profile = null;

// --- UTILITY ---
function safeVal(v, fallback = 'N/A') {
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return (s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'none') ? fallback : s;
}

function stripMarkdown(text) {
    return text
        // Remove markdown tables entirely (lines starting or ending with |)
        .replace(/^\|.*\|$/gm, '')
        // Remove table separator rows like | --- | --- |
        .replace(/^\s*\|?\s*[-:]+\s*\|.*$/gm, '')
        // **bold** and __bold__
        .replace(/\*\*(.+?)\*\*/gs, '$1')
        .replace(/__(.+?)__/gs, '$1')
        // *italic* and _italic_
        .replace(/\*(.+?)\*/gs, '$1')
        .replace(/_(.+?)_/gs, '$1')
        // Remove any remaining lone * or _ symbols
        .replace(/\*/g, '')
        .replace(/_/g, ' ')
        // ## Headings
        .replace(/^#{1,6}\s*/gm, '')
        // Code blocks ```...```
        .replace(/```[\s\S]*?```/g, '')
        // Inline `code`
        .replace(/`(.+?)`/g, '$1')
        // Horizontal rules
        .replace(/^[-*_]{3,}$/gm, '')
        // [link text](url)
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        // Numbered list markers "1. " → plain (keep the text)
        .replace(/^\s*\d+\.\s+/gm, '')
        // Bullet list markers "- " or "* " or "+ " at line start → plain
        .replace(/^\s*[-+]\s+/gm, '')
        // Collapse extra blank lines
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}


// --- VOICE CHAT ENGINE ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let activeRecognizer = null;       // currently running recognizer
let speakerEnabled = { student: false, staff: false };

function toggleVoice(role) {
    if (!SpeechRecognition) {
        alert('Voice input is not supported in this browser. Please use Chrome or Edge.');
        return;
    }

    const prefix = role === 'student' ? 'stu' : 'staff';
    const btn     = document.getElementById(`${prefix}-mic-btn`);
    const inputEl = document.getElementById(`${prefix}-input`);

    // If already listening → stop
    if (activeRecognizer) {
        activeRecognizer.stop();
        activeRecognizer = null;
        btn.classList.remove('mic-active');
        return;
    }

    const recognizer = new SpeechRecognition();
    recognizer.lang = 'en-IN';        // Indian English accent
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;
    activeRecognizer = recognizer;

    btn.classList.add('mic-active');

    recognizer.onresult = (event) => {
        let interim = '';
        let final   = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) final += t;
            else interim += t;
        }
        // Show interim text as placeholder while speaking
        inputEl.value = final || interim;
    };

    recognizer.onend = () => {
        btn.classList.remove('mic-active');
        activeRecognizer = null;
        const text = inputEl.value.trim();
        if (text) {
            // Small delay so user can see what was captured
            setTimeout(() => sendQuery(role), 300);
        }
    };

    recognizer.onerror = (e) => {
        btn.classList.remove('mic-active');
        activeRecognizer = null;
        if (e.error === 'not-allowed') {
            alert('Microphone access denied. Please allow microphone permission in your browser.');
        }
    };

    recognizer.start();
}

function toggleSpeaker(role) {
    speakerEnabled[role] = !speakerEnabled[role];
    const prefix = role === 'student' ? 'stu' : 'staff';
    const btn = document.getElementById(`${prefix}-speaker-btn`);
    if (speakerEnabled[role]) {
        btn.classList.add('speaker-active');
        btn.title = 'AI Voice: ON (click to mute)';
    } else {
        btn.classList.remove('speaker-active');
        btn.title = 'AI Voice: OFF (click to enable)';
        window.speechSynthesis.cancel(); // stop any ongoing speech
    }
}

function speakText(role, text) {
    if (!speakerEnabled[role]) return;
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel(); // cancel any previous speech
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang  = 'en-IN';
    utter.rate  = 1.05;
    utter.pitch = 1.0;

    // Pick a female voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'))
                   || voices.find(v => v.lang.startsWith('en-IN'))
                   || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utter.voice = preferred;

    window.speechSynthesis.speak(utter);
}


// --- AI FALLBACK CACHE ---
const FALLBACK_CACHE = {
    student: [
        { match: ['cgpa','gpa','grade'], reply: "Your current CGPA is {cgpa}. Based on your GPA history, you have been consistently performing well. Keep focusing on your weak subjects to improve further." },
        { match: ['attendance','present'], reply: "Your current attendance is {attendance}. Make sure to maintain above 75% to avoid detainment." },
        { match: ['backlog','arrear','arrears'], reply: "Backlog status: {arrears} arrear(s) recorded. Please clear pending papers at the earliest to stay on track." },
        { match: ['skill','technology','know'], reply: "Your recorded skills are: {skills}. Consider deepening expertise in one or two of these to stand out in placements." },
        { match: ['goal','career','future'], reply: "Your stated career goal is: {career_goal}. Align your projects and internships toward this goal for a stronger profile." },
        { match: ['project'], reply: "You have completed {projects} project(s). Projects are your strongest differentiator — keep building!" }
    ],
    staff: [
        { match: ['top','performing','best'], reply: "Based on CGPA rankings in the class dataset, the top students are those with CGPA above 8.5. Consider recognizing their efforts formally." },
        { match: ['backlog','arrear'], reply: "Students with arrears have been flagged in the system. Regular follow-up sessions are recommended for them." },
        { match: ['attendance'], reply: "Class average attendance stands at approximately 82%. Students below 75% are at risk and should be personally counselled." },
        { match: ['improve','weak','low'], reply: "Students with CGPA below 6.5 need immediate academic intervention. Personalized mentoring and extra sessions are recommended." }
    ]
};

function getFallbackReply(role, message, profile) {
    const lower = message.toLowerCase();
    const bank = FALLBACK_CACHE[role] || [];
    for (const entry of bank) {
        if (entry.match.some(k => lower.includes(k))) {
            let reply = entry.reply;
            if (profile) {
                reply = reply
                    .replace('{cgpa}', safeVal(profile.cgpa))
                    .replace('{attendance}', safeVal(profile.attendance))
                    .replace('{arrears}', safeVal(profile.arrears, '0'))
                    .replace('{skills}', safeVal(profile.skills))
                    .replace('{career_goal}', safeVal(profile.career_goal))
                    .replace('{projects}', safeVal(profile.projects));
            }
            return reply;
        }
    }
    return null;
}

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
    } else if(role === 'hod') {
        title.innerText = 'HOD Authentication';
        hint.innerText = 'Required: Admin ID & Password';
        idLabel.innerText = 'Admin ID';
        idInput.placeholder = 'Enter ID...';
        passLabel.innerText = 'Password';
        passInput.placeholder = 'Enter Password...';
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
    localStorage.removeItem('genesis_session');
    showView('landing');
}

// --- AUTHENTICATION ---
async function handleLogin() {
    const id = document.getElementById('login-id').value.trim();
    const pass = document.getElementById('login-pass').value.trim();

    if(!id || !pass) return alert("System requires full credentials.");

    if(currentRole === 'hod') {
        if(id === 'kavidha' && pass === 'hod') {
            profile = {
                name: "Dr.A.Kavidha",
                title: "Associate Professor, Dept. Of CSE, GCEE",
                qualification: "M.E.,Ph.D",
                experience: "32 Years",
                specialization: "Semantic Web",
                conference: "3 & 6",
                contact: "9442513055",
                email: "kavitha@gcee.ac.in, kavitha.irtt@gmail.com",
                staff_id: "kavidha"
            };
            localStorage.setItem('genesis_session', JSON.stringify({ role: 'hod', profile }));
            setupStaffDashboard();
            showView('staff');
        } else {
            alert("Entry Denied: Invalid HOD Key.");
        }
        return;
    }

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
                staff_id: "vasuki"
            };
            localStorage.setItem('genesis_session', JSON.stringify({ role: 'staff', profile }));
            setupStaffDashboard();
            showView('staff');
        } else if(id === 'thenmozhi' && pass === 'classadviser') {
            profile = {
                name: "Dr.D.S.Thenmozhi",
                title: "Assistant Professor(SR), Dept. Of CSE, IRTT",
                qualification: "M.E,Ph.D",
                experience: "18+ Years",
                specialization: "N/A",
                conference: "4 & 4",
                contact: "+91-98429 81158",
                email: "N/A",
                staff_id: "thenmozhi"
            };
            localStorage.setItem('genesis_session', JSON.stringify({ role: 'staff', profile }));
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
            localStorage.setItem('genesis_session', JSON.stringify({ role: 'staff', profile }));
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
        let data;
        try {
            data = await res.json();
        } catch(jsonErr) {
            alert(`Server Error (HTTP ${res.status}): The server returned an unexpected response. Make sure the server is running correctly.`);
            return;
        }
        if(data.status === 'success') {
            profile = data.profile;
            localStorage.setItem('genesis_session', JSON.stringify({ role: 'student', profile }));
            setupDashboard();
            showView('student');
        } else {
            alert(data.message);
        }
    } catch(e) {
        alert(`Connection Error: Cannot reach the server at ${API}.\n\nMake sure:\n1. You opened this page via http://127.0.0.1:5000\n2. Python server is running (python app.py)`);
    }
}

function setupDashboard() {
    const name = safeVal(profile.name, 'Student');
    document.getElementById('stu-name').innerText = name;
    document.getElementById('stu-initial').innerText = name.charAt(0);
    document.getElementById('stu-dept').innerText = `${safeVal(profile.year)} • ${safeVal(profile.dept)}`;
    document.getElementById('val-cgpa').innerText = safeVal(profile.cgpa);
    document.getElementById('val-att').innerText = safeVal(profile.attendance) !== 'N/A' ? safeVal(profile.attendance) + '%' : 'N/A';
    document.getElementById('val-proj').innerText = safeVal(profile.projects) !== 'N/A' ? safeVal(profile.projects).padStart(2, '0') : 'N/A';
    document.getElementById('rec-id').innerText    = safeVal(profile.reg_no);
    document.getElementById('rec-email').innerText  = safeVal(profile.email);
    document.getElementById('rec-year').innerText   = `${safeVal(profile.year)} • ${safeVal(profile.dept)}`;
    document.getElementById('rec-skills').innerText = safeVal(profile.skills, 'Not recorded');
    document.getElementById('rec-goal').innerText   = safeVal(profile.career_goal, 'N/A');

    // Photo Loading
    loadStudentPhoto(profile.reg_no);

    // New Data Populating — all NaN-safe
    document.getElementById('val-aptitude').innerText = safeVal(profile.aptitude_score);
    document.getElementById('val-interview').innerText = safeVal(profile.interview_rating);
    document.getElementById('val-arrears').innerText = safeVal(profile.arrears, '0');

    // GPA Sparkline + text labels
    const timeline = document.getElementById('gpa-timeline');
    timeline.innerHTML = '';
    const gpaValues = [];
    const gpaLabels = [];

    if (profile.gpa_history) {
        Object.entries(profile.gpa_history).forEach(([sem, gpa]) => {
            const gpaNum = parseFloat(gpa);
            if (!isNaN(gpaNum)) { gpaValues.push(gpaNum); gpaLabels.push(sem); }

            const item = document.createElement('div');
            item.style.cssText = 'text-align:center;min-width:48px';
            item.innerHTML = `
                <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:4px">${sem}</div>
                <div style="font-weight:700;color:var(--primary);font-size:1.1rem">${safeVal(gpa, '--')}</div>
            `;
            timeline.appendChild(item);
        });
    }

    // CGPA Trend
    const trendEl = document.getElementById('val-cgpa-trend');
    if (trendEl && gpaValues.length >= 2) {
        const diff = (gpaValues[gpaValues.length - 1] - gpaValues[gpaValues.length - 2]).toFixed(2);
        if (parseFloat(diff) > 0) {
            trendEl.className = 'trend-up';
            trendEl.innerText = `▲ +${diff} from last sem`;
        } else if (parseFloat(diff) < 0) {
            trendEl.className = 'trend-down';
            trendEl.innerText = `▼ ${diff} from last sem`;
        } else {
            trendEl.className = 'trend-same';
            trendEl.innerText = `→ No change`;
        }
    }

    // Draw Chart.js sparkline
    if (gpaValues.length > 1) {
        const sparkCanvas = document.getElementById('gpa-sparkline');
        if (sparkCanvas) {
            // Destroy previous chart instance if any
            if (sparkCanvas._chartInstance) sparkCanvas._chartInstance.destroy();
            sparkCanvas._chartInstance = new Chart(sparkCanvas, {
                type: 'line',
                data: {
                    labels: gpaLabels,
                    datasets: [{
                        data: gpaValues,
                        borderColor: '#818cf8',
                        backgroundColor: 'rgba(129,140,248,0.15)',
                        borderWidth: 3,
                        pointBackgroundColor: gpaValues.map((v, i) =>
                            i === gpaValues.length - 1 ? '#4ade80' : '#818cf8'),
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: {
                        callbacks: { label: ctx => `GPA: ${ctx.parsed.y}` }
                    }},
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#a1a1aa', font: { family: 'Outfit', size: 11 } } },
                        y: {
                            min: Math.max(0, Math.min(...gpaValues) - 0.5),
                            max: Math.min(10, Math.max(...gpaValues) + 0.5),
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            ticks: { color: '#a1a1aa', font: { family: 'Outfit', size: 11 } }
                        }
                    }
                }
            });
        }
    }

    // Reset chat and show sample questions
    const stuBox = document.getElementById('stu-chat-box');
    stuBox.innerHTML = '<div class="msg msg-ai">Welcome to your academic command center. Neural links established. How can I assist?</div>';
    renderSampleQuestions('student');

    // --- NEW FEATURE PANELS ---
    fetchNewsFeed();
    renderSpeedometer(profile);
    initSkillCheckState();
    renderResourceMatrix(profile);
    renderPeerBenchmark(profile);
    if (window.lucide) lucide.createIcons();
}

function setupStaffDashboard() {
    if(!profile) return;
    document.getElementById('staff-name').innerText = safeVal(profile.name);
    document.getElementById('staff-title').innerText = safeVal(profile.title);
    document.getElementById('staff-qual').innerText = safeVal(profile.qualification);
    document.getElementById('staff-exp').innerText = safeVal(profile.experience);
    document.getElementById('staff-spec').innerText = safeVal(profile.specialization);
    document.getElementById('staff-conf').innerText = safeVal(profile.conference);
    document.getElementById('staff-contact').innerText = safeVal(profile.contact);
    document.getElementById('staff-email').innerText = safeVal(profile.email);
    document.getElementById('staff-initial').innerText = (profile.name || 'S').charAt(0);

    // Photo Loading
    loadStaffPhoto(profile.staff_id || profile.name.toLowerCase().split(' ')[0]);

    // Student Spotlight — fetch from backend
    fetch(`${API}/spotlight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: profile.staff_id || "" })
    })
        .then(r => r.json())
        .then(d => {
            if (d.status === 'success') {
                const s = d.student;
                document.getElementById('spot-name').innerText = safeVal(s.Name);
                document.getElementById('spot-projects').innerText = safeVal(s.Projects) + ' projects';
                document.getElementById('spot-cgpa').innerText = 'CGPA ' + safeVal(s.CGPA);
                document.getElementById('spot-goal').innerText = safeVal(s.Career_Goal);
                document.getElementById('spot-skills').innerText = safeVal(s.Skills);
                document.getElementById('spotlight-card').style.display = 'block';
            }
        })
        .catch(() => {}); // fail silently

    // Reset chat and show sample questions
    const staffBox = document.getElementById('staff-chat-box');
    staffBox.innerHTML = '<div class="msg msg-ai">Faculty environment synchronized. I am ready to evaluate class trends or generate visualization reports.</div>';
    renderSampleQuestions('staff');

    // Load skill-check scores
    loadStaffScores();

    // HOD UI Modifications
    if (currentRole === 'hod') {
        const hideEl = (id) => { const el = document.getElementById(id); if(el) el.style.display = 'none'; };
        hideEl('staff-scoreboard-card');
        hideEl('staff-stat-1');
        hideEl('staff-stat-2');
        hideEl('staff-stat-3');
    } else {
        const showEl = (id) => { const el = document.getElementById(id); if(el) el.style.display = 'block'; };
        showEl('staff-profile-card');
        showEl('staff-scoreboard-card');
        showEl('staff-stat-1');
        showEl('staff-stat-2');
        showEl('staff-stat-3');
        // Spotlight is shown inside the fetch callback if successful.
    }
}

async function loadStaffScores() {
    try {
        const res  = await fetch(`${API}/admin/scores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staff_id: profile ? profile.staff_id : "" })
        });
        const data = await res.json();
        if (data.status !== 'success') return;

        // Update summary counters
        const subEl = document.getElementById('sc-submitted');
        const notEl = document.getElementById('sc-not-submitted');
        const totEl = document.getElementById('sc-total');
        if (subEl) subEl.textContent = data.submitted;
        if (notEl) notEl.textContent = data.not_submitted;
        if (totEl) totEl.textContent = data.total_students;

        const listEl = document.getElementById('staff-score-list');
        if (!listEl) return;

        if (data.scores.length === 0) {
            listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:20px 0;text-align:center">No students found.</div>';
            return;
        }

        const submitted = data.scores.filter(s => s.submitted).sort((a,b) => b.score - a.score);
        const notSubmitted = data.scores.filter(s => !s.submitted).sort((a,b) => a.name.localeCompare(b.name));

        listEl.innerHTML = [
            ...submitted.map((s, idx) => {
                const pct   = Math.round((s.score / s.total) * 100);
                const color = pct >= 70 ? '#4ade80' : pct >= 50 ? '#fbbf24' : '#f87171';
                const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`;
                return `<div style="padding:10px 12px;border-radius:10px;border:1px solid var(--glass-border);background:rgba(255,255,255,0.03);display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <div style="font-weight:600;font-size:0.85rem">${medal} ${safeVal(s.name)}</div>
                        <div style="font-size:0.65rem;color:var(--text-muted)">${s.reg_no} · ${s.submitted_at}</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-weight:700;color:${color}">${s.score}/${s.total}</div>
                    </div>
                </div>`;
            }),
            ...notSubmitted.map(s => {
                return `<div style="padding:10px 12px;border-radius:10px;border:1px dashed rgba(255,255,255,0.1);background:transparent;display:flex;justify-content:space-between;align-items:center;opacity:0.6">
                    <div>
                        <div style="font-weight:500;font-size:0.85rem">${safeVal(s.name)}</div>
                        <div style="font-size:0.65rem;color:var(--text-muted)">${s.reg_no}</div>
                    </div>
                    <div style="font-size:0.75rem;color:#f87171;font-weight:600">Pending</div>
                </div>`;
            })
        ].join('');
    } catch(e) {
        // fail silently — server may not have scores yet
    }
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

// --- SAMPLE QUESTIONS ---
const SAMPLE_QUESTIONS = {
    student: [
        "What is my current CGPA?",
        "How is my attendance this semester?",
        "What are my skills and career goal?",
        "Do I have any backlogs?",
        "Show me my GPA chart"
    ],
    staff: [
        "Who are the top performing students?",
        "Show me class attendance overview",
        "Which students have backlogs?",
        "Give me a GPA distribution chart",
        "Who needs academic improvement?"
    ]
};

function renderSampleQuestions(role) {
    const boxId = role === 'student' ? 'stu-chat-box' : 'staff-chat-box';
    const inputId = role === 'student' ? 'stu-input' : 'staff-input';
    const box = document.getElementById(boxId);

    const wrap = document.createElement('div');
    wrap.className = 'sample-questions-wrap';
    wrap.innerHTML = `<div class="sample-qs-label">✦ Try asking...</div><div class="sample-qs-chips" id="chips-${role}"></div>`;

    const chipsEl = wrap.querySelector(`#chips-${role}`);
    SAMPLE_QUESTIONS[role].forEach(q => {
        const chip = document.createElement('button');
        chip.className = 'sample-chip';
        chip.innerText = q;
        chip.onclick = () => {
            document.getElementById(inputId).value = q;
            wrap.remove();
            sendQuery(role);
        };
        chipsEl.appendChild(chip);
    });

    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
}

// --- CHAT SYSTEM ---
async function sendQuery(role) {
    const inputId = role === 'student' ? 'stu-input' : 'staff-input';
    const boxId = role === 'student' ? 'stu-chat-box' : 'staff-chat-box';
    const input = document.getElementById(inputId);
    const box = document.getElementById(boxId);
    const text = input.value.trim();

    if(!text) return;

    // Remove sample questions on first real chat
    const oldChips = box.querySelector('.sample-questions-wrap');
    if(oldChips) oldChips.remove();

    addMsg(box, text, 'msg-user');
    input.value = '';

    // Show thinking animation
    const thinkBubble = addThinkingBubble(box);

    const endpoint = role === 'student' ? '/student/chat' : '/chat';
    const body = role === 'student' ? { reg_no: profile.reg_no, message: text } : { message: text, staff_id: profile.staff_id };

    try {
        const res = await fetch(`${API}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();

        thinkBubble.remove();

        if(data.type === 'chart') {
            const chartReply = stripMarkdown(data.reply || "Analysis Complete.");
            addMsg(box, chartReply, 'msg-ai');
            speakText(role, chartReply);
            renderChart(box, data.chart_data);
        } else {
            const textReply = stripMarkdown(data.reply || data.message || "Logic Error.");
            addMsg(box, textReply, 'msg-ai');
            speakText(role, textReply);
        }
    } catch(e) {
        thinkBubble.remove();
        // Try local fallback cache before showing error
        const cached = getFallbackReply(role, text, profile);
        if (cached) {
            const cleanCached = stripMarkdown(cached);
            addMsg(box, cleanCached + '\n\n⚠️ (Offline mode — AI unavailable)', 'msg-ai');
            speakText(role, cleanCached);
        } else {
            addMsg(box, "⚠️ AI Offline: Cannot reach the analysis engine. Please check your connection.", 'msg-ai');
        }
    }
}

function addThinkingBubble(box) {
    const d = document.createElement('div');
    d.className = 'msg msg-ai msg-thinking';
    d.innerHTML = `<span class="dot"></span><span class="dot"></span><span class="dot"></span>`;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
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
    
    const chartType = data.chart_type || 'bar';
    const isRadar = chartType === 'radar';
    const isDoughnut = chartType === 'doughnut' || chartType === 'pie';

    const commonColors = ['#818cf8', '#c084fc', '#22d3ee', '#f472b6', '#fbbf24', '#4ade80', '#fb923c'];

    const dataset = {
        label: data.title,
        data: data.data,
        backgroundColor: isDoughnut || isRadar
            ? commonColors.slice(0, data.data.length)
            : commonColors,
        borderColor: isRadar ? 'rgba(129,140,248,0.6)' : 'transparent',
        borderWidth: isRadar ? 2 : 0,
        borderRadius: (chartType === 'bar') ? 12 : 0,
        fill: isRadar
    };

    new Chart(wrap.querySelector('canvas'), {
        type: chartType,
        data: {
            labels: data.labels,
            datasets: [dataset]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    display: isDoughnut,
                    labels: { color: '#a1a1aa', font: { family: 'Outfit', size: 12 } } 
                }
            },
            scales: isRadar ? {
                r: {
                    grid: { color: 'rgba(255,255,255,0.07)' },
                    ticks: { color: '#a1a1aa', backdropColor: 'transparent' },
                    pointLabels: { color: '#a1a1aa', font: { family: 'Outfit', size: 11 } }
                }
            } : isDoughnut ? {} : {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#a1a1aa' } },
                x: { grid: { display: false }, ticks: { color: '#a1a1aa' } }
            }
        }
    });
    box.scrollTop = box.scrollHeight;
}

// Ensure icons load + restore session from localStorage
document.addEventListener('DOMContentLoaded', () => {
    if(window.lucide) lucide.createIcons();

    // --- SESSION PERSISTENCE ---
    const saved = localStorage.getItem('genesis_session');
    if (saved) {
        try {
            const session = JSON.parse(saved);
            profile = session.profile;
            currentRole = session.role;
            if (session.role === 'student') {
                setupDashboard();
                showView('student');
                document.getElementById('nav-actions').classList.add('hidden');
                document.getElementById('nav-home').classList.remove('hidden');
            } else if (session.role === 'staff' || session.role === 'hod') {
                setupStaffDashboard();
                showView('staff');
                document.getElementById('nav-actions').classList.add('hidden');
                document.getElementById('nav-home').classList.remove('hidden');
            }
        } catch(e) {
            localStorage.removeItem('genesis_session');
        }
    }
});

// Default image as inline SVG data URI (never fails to load)
const NEWS_DEFAULT_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' fill='%23818cf8' rx='10'/%3E%3Ctext x='24' y='32' text-anchor='middle' fill='white' font-size='18' font-family='sans-serif' font-weight='bold'%3EAI%3C/text%3E%3C/svg%3E";

const FALLBACK_NEWS = [
    { title: "Google DeepMind Unveils Gemini 2.0: A New Era of Multimodal AI", pubDate: "2 hours ago", thumbnail: NEWS_DEFAULT_IMG, link: "https://deepmind.google" },
    { title: "OpenAI's GPT-5 Shows Human-Level Reasoning on Complex Benchmarks", pubDate: "5 hours ago", thumbnail: NEWS_DEFAULT_IMG, link: "https://openai.com" },
    { title: "Meta AI Releases Open-Source LLaMA 4 with 405B Parameters", pubDate: "8 hours ago", thumbnail: NEWS_DEFAULT_IMG, link: "https://ai.meta.com" },
    { title: "Microsoft Copilot Now Integrated into 200+ Enterprise Applications", pubDate: "1 day ago", thumbnail: NEWS_DEFAULT_IMG, link: "https://copilot.microsoft.com" },
    { title: "India's AI Mission: Government Allocates ₹10,000 Cr for Semiconductor Research", pubDate: "1 day ago", thumbnail: NEWS_DEFAULT_IMG, link: "https://indiaai.gov.in" }
];

async function fetchNewsFeed() {
    const list = document.getElementById('news-feed-list');
    if (!list) return;

    let articles = [];
    try {
        const rssUrl = encodeURIComponent('https://feeds.feedburner.com/TechCrunch/');
        const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}&count=5`;
        const resp = await fetch(apiUrl);
        const data = await resp.json();
        if (data.status === 'ok' && data.items && data.items.length > 0) {
            articles = data.items.slice(0, 5).map(item => ({
                title: item.title,
                pubDate: timeAgo(new Date(item.pubDate)),
                thumbnail: item.thumbnail || item.enclosure?.link || NEWS_DEFAULT_IMG,
                link: item.link
            }));
        } else {
            articles = FALLBACK_NEWS;
        }
    } catch(e) {
        articles = FALLBACK_NEWS;
        const statusEl = document.getElementById('news-feed-status');
        if (statusEl) { statusEl.textContent = '● Cached'; statusEl.style.color = 'var(--text-muted)'; }
    }

    list.innerHTML = '';
    articles.forEach(a => {
        const el = document.createElement('a');
        el.className = 'news-item';
        el.href = a.link;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
        el.innerHTML = `
            <img class="news-thumbnail" src="${a.thumbnail}" alt="AI News"
                 onerror="this.onerror=null;this.src='${NEWS_DEFAULT_IMG}'">
            <div class="news-text">
                <div class="news-headline">${a.title}</div>
                <div class="news-time"><i data-lucide="clock" style="width:10px;display:inline;vertical-align:middle;margin-right:3px"></i>${a.pubDate}</div>
            </div>
            <i data-lucide="external-link" class="news-arrow"></i>
        `;
        list.appendChild(el);
    });
    if (window.lucide) lucide.createIcons();
}

function timeAgo(date) {
    const secs = Math.floor((new Date() - date) / 1000);
    if (secs < 3600) return `${Math.floor(secs/60)} min ago`;
    if (secs < 86400) return `${Math.floor(secs/3600)} hr ago`;
    return `${Math.floor(secs/86400)} day${Math.floor(secs/86400)>1?'s':''} ago`;
}

// ============================================================
// FEATURE 2: PLACEMENT READINESS SPEEDOMETER  (6 criteria)
// ============================================================
function renderSpeedometer(prof) {
    const cgpa      = parseFloat(safeVal(prof.cgpa, '0'));
    const projects  = parseInt(safeVal(prof.projects, '0')) || 0;
    const arrears   = parseInt(safeVal(prof.arrears, '1')) || 0;
    const interview = parseFloat(safeVal(prof.interview_rating, '0'));
    const aptitude  = parseFloat(safeVal(prof.aptitude_score, '0'));
    const attendance= parseFloat(safeVal(prof.attendance, '0'));

    let pct = 0;
    const breakdown = [];

    // 6 criteria totaling 100%
    if (cgpa > 8.0)       { pct += 20; breakdown.push({ label: 'CGPA >8.0',     pts: '+20', ok: true  }); }
    else                  {             breakdown.push({ label: 'CGPA >8.0',     pts: '0',   ok: false }); }
    if (arrears === 0)    { pct += 20; breakdown.push({ label: 'No Arrears',     pts: '+20', ok: true  }); }
    else                  {             breakdown.push({ label: 'No Arrears',     pts: '0',   ok: false }); }
    if (attendance >= 75) { pct += 15; breakdown.push({ label: 'Attend. ≥75%',  pts: '+15', ok: true  }); }
    else                  {             breakdown.push({ label: 'Attend. ≥75%',  pts: '0',   ok: false }); }
    if (projects >= 2)    { pct += 20; breakdown.push({ label: 'Projects ≥2',   pts: '+20', ok: true  }); }
    else                  {             breakdown.push({ label: 'Projects ≥2',   pts: '0',   ok: false }); }
    if (aptitude >= 60)   { pct += 15; breakdown.push({ label: 'Aptitude ≥60',  pts: '+15', ok: true  }); }
    else                  {             breakdown.push({ label: 'Aptitude ≥60',  pts: '0',   ok: false }); }
    if (interview >= 6)   { pct += 10; breakdown.push({ label: 'Interview ≥6',  pts: '+10', ok: true  }); }
    else                  {             breakdown.push({ label: 'Interview ≥6',  pts: '0',   ok: false }); }

    // Render breakdown chips
    const bdEl = document.getElementById('speedometer-breakdown');
    if (bdEl) {
        bdEl.innerHTML = breakdown.map(b => `
            <span style="padding:4px 10px;border-radius:20px;background:${b.ok ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)'};
                  border:1px solid ${b.ok ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.1)'};
                  color:${b.ok ? '#4ade80' : 'var(--text-muted)'};
                  display:inline-flex;align-items:center;gap:4px">
                <span>${b.ok ? '✓' : '✗'}</span> ${b.label} <strong>${b.pts}%</strong>
            </span>`).join('');
    }

    const canvas = document.getElementById('speedometer-canvas');
    const pctEl  = document.getElementById('speedometer-pct');
    const lblEl  = document.getElementById('speedometer-label');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H - 10, R = H - 20;

    let label, color;
    if (pct < 30)       { label = 'At Risk';        color = '#f87171'; }
    else if (pct < 55)  { label = 'Developing';     color = '#fbbf24'; }
    else if (pct < 75)  { label = 'On Track';       color = '#a3e635'; }
    else                { label = 'Placement Ready'; color = '#4ade80'; }

    if (lblEl) lblEl.textContent = label;

    let current = 0;
    const target = pct;
    const duration = 1200;
    const startTime = performance.now();

    function drawFrame(now) {
        const elapsed  = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease     = 1 - Math.pow(1 - progress, 3);
        current        = target * ease;

        ctx.clearRect(0, 0, W, H);

        // Track arc
        ctx.beginPath();
        ctx.arc(cx, cy, R, Math.PI, 0);
        ctx.lineWidth   = 18;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineCap     = 'round';
        ctx.stroke();

        // Gradient fill arc
        const gradient = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
        gradient.addColorStop(0,   '#f87171');
        gradient.addColorStop(0.5, '#fbbf24');
        gradient.addColorStop(1,   '#4ade80');

        const fillAngle = Math.PI + (Math.PI * current / 100);
        ctx.beginPath();
        ctx.arc(cx, cy, R, Math.PI, fillAngle);
        ctx.lineWidth   = 18;
        ctx.strokeStyle = gradient;
        ctx.lineCap     = 'round';
        ctx.stroke();

        // Needle
        const needleAngle = Math.PI + (Math.PI * current / 100);
        const nx = cx + (R - 5) * Math.cos(needleAngle);
        const ny = cy + (R - 5) * Math.sin(needleAngle);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(nx, ny);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 3;
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (pctEl) { pctEl.textContent = Math.round(current) + '%'; pctEl.style.color = color; }
        if (progress < 1) requestAnimationFrame(drawFrame);
    }
    requestAnimationFrame(drawFrame);
}

// ============================================================
// FEATURE 3: DAILY SKILL-CHECK
// ============================================================
const SKILL_QUESTIONS = [
    // --- APTITUDE ---
    { section: 'APTITUDE', q: 'If 12 men can finish a job in 15 days, how many days will 9 men take?', opts: ['18', '20', '22', '25'], ans: 1 },
    { section: 'APTITUDE', q: 'A train travels 360 km in 4 hours. What is its speed in m/s?', opts: ['22.5', '25', '20', '30'], ans: 0 },
    { section: 'APTITUDE', q: 'What is 15% of 480?', opts: ['62', '70', '72', '80'], ans: 2 },
    { section: 'APTITUDE', q: 'Two numbers are in ratio 3:5. Their sum is 96. Find the larger number.', opts: ['36', '48', '60', '64'], ans: 2 },
    { section: 'APTITUDE', q: 'Find the next number: 2, 6, 18, 54, ___', opts: ['108', '162', '216', '270'], ans: 1 },
    // --- PROGRAMMING ---
    { section: 'PROGRAMMING', q: 'What is the time complexity of Binary Search?', opts: ['O(n)', 'O(n²)', 'O(log n)', 'O(n log n)'], ans: 2 },
    { section: 'PROGRAMMING', q: 'Which data structure uses LIFO principle?', opts: ['Queue', 'Stack', 'Tree', 'Graph'], ans: 1 },
    { section: 'PROGRAMMING', q: 'In Python, what does `len([1, [2, 3], 4])` return?', opts: ['2', '3', '4', 'Error'], ans: 1 },
    { section: 'PROGRAMMING', q: 'Which sorting algorithm has the best average-case time?', opts: ['Bubble Sort', 'Insertion Sort', 'Quick Sort', 'Selection Sort'], ans: 2 },
    { section: 'PROGRAMMING', q: 'What does OOP stand for?', opts: ['Object Oriented Programming', 'Open Object Processing', 'Optimized Output Protocol', 'None'], ans: 0 }
];

let quizCurrentQ = 0;
let quizAnswers  = [];
let quizSelected = null;

function getSkillCheckKey() {
    const d = new Date();
    const reg = profile ? profile.reg_no : 'guest';
    return `genesis_skillcheck_${reg}_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function initSkillCheckState() {
    const key = getSkillCheckKey();
    const saved = localStorage.getItem(key);
    if (saved) {
        // Already submitted today
        const { score, total } = JSON.parse(saved);
        showSkillResult(score, total, false);
        // Auto-sync to backend in case it was lost
        submitDailyScore(score, total);
    } else {
        // Show init screen
        document.getElementById('skill-init').style.display = 'block';
        document.getElementById('skill-quiz').style.display = 'none';
        document.getElementById('skill-result').style.display = 'none';
        quizAnswers.length = 0;
        document.getElementById('skill-answer-review').style.display = 'none';
    }
}

function startSkillCheck() {
    quizCurrentQ = 0;
    quizAnswers  = [];
    quizSelected = null;
    document.getElementById('skill-init').style.display = 'none';
    document.getElementById('skill-quiz').style.display = 'block';
    renderQuestion();
}

function renderQuestion() {
    const q = SKILL_QUESTIONS[quizCurrentQ];
    document.getElementById('quiz-section-label').textContent = q.section;
    document.getElementById('quiz-progress').textContent = `Q${quizCurrentQ + 1} / 10`;
    document.getElementById('quiz-question').textContent = q.q;
    quizSelected = null;

    const optContainer = document.getElementById('quiz-options');
    optContainer.innerHTML = '';
    q.opts.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option';
        btn.textContent = opt;
        btn.onclick = () => {
            quizSelected = i;
            optContainer.querySelectorAll('.quiz-option').forEach((b, bi) => {
                b.classList.toggle('quiz-option-selected', bi === i);
            });
        };
        optContainer.appendChild(btn);
    });
}

function nextQuestion() {
    if (quizSelected === null) {
        // No choice — count as wrong
        quizAnswers.push(false);
    } else {
        quizAnswers.push(quizSelected === SKILL_QUESTIONS[quizCurrentQ].ans);
    }
    quizCurrentQ++;
    if (quizCurrentQ < SKILL_QUESTIONS.length) {
        renderQuestion();
    } else {
        const score = quizAnswers.filter(Boolean).length;
        const total = SKILL_QUESTIONS.length;
        showSkillResult(score, total, true);
        // Persist
        localStorage.setItem(getSkillCheckKey(), JSON.stringify({ score, total }));
        // POST to backend
        submitDailyScore(score, total);
    }
}

function showSkillResult(score, total, showReview) {
    document.getElementById('skill-init').style.display = 'none';
    document.getElementById('skill-quiz').style.display = 'none';
    const resultEl = document.getElementById('skill-result');
    resultEl.style.display = 'block';

    const pct = Math.round((score / total) * 100);
    const color = pct >= 70 ? '#4ade80' : pct >= 50 ? '#fbbf24' : '#f87171';
    document.getElementById('skill-score-display').innerHTML =
        `<span style="color:${color}">${score}/${total}</span>`;

    // Show answer review if this is a fresh submission
    if (showReview && quizAnswers.length > 0) {
        const reviewEl = document.getElementById('skill-answer-review');
        if (reviewEl) {
            reviewEl.style.display = 'block';
            reviewEl.innerHTML = `<div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:10px">Answer Review</div>` +
            SKILL_QUESTIONS.map((q, i) => {
                const isCorrect = quizAnswers[i];
                return `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;padding:8px 10px;border-radius:10px;background:${isCorrect ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)'};border:1px solid ${isCorrect ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}">
                    <span style="font-size:1rem">${isCorrect ? '✓' : '✗'}</span>
                    <div style="flex:1;font-size:0.8rem">
                        <div style="font-weight:500;margin-bottom:2px">${q.q}</div>
                        <div style="color:${isCorrect ? '#4ade80' : '#f87171'}">Correct: <strong>${q.opts[q.ans]}</strong></div>
                    </div>
                </div>`;
            }).join('');
        }
    }
}

async function submitDailyScore(score, total) {
    if (!profile) return;
    try {
        await fetch(`${API}/student/submit_score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reg_no: profile.reg_no,
                name: profile.name || 'Unknown',
                score,
                total
            })
        });
    } catch(e) { /* fail silently */ }
}

// ============================================================
// FEATURE 4: RESOURCE MATRIX
// ============================================================
const RESOURCE_DB = {
    python:            [
        { icon: 'book-open', title: 'Python Official Docs', source: 'python.org', url: 'https://docs.python.org/3/', color: '#fbbf24' },
        { icon: 'youtube', title: 'FreeCodeCamp Python Course', source: 'YouTube', url: 'https://www.youtube.com/watch?v=rfscVS0vtbw', color: '#f87171' },
        { icon: 'graduation-cap', title: 'Kaggle Learn: Python', source: 'Kaggle', url: 'https://www.kaggle.com/learn/python', color: '#22d3ee' }
    ],
    'data structures': [
        { icon: 'git-branch', title: 'MIT 6.006 Introduction to Algorithms', source: 'MIT OCW', url: 'https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/', color: '#818cf8' },
        { icon: 'code-2', title: 'NeetCode DSA Roadmap', source: 'NeetCode.io', url: 'https://neetcode.io/', color: '#4ade80' },
        { icon: 'database', title: 'GeeksForGeeks DSA', source: 'GFG', url: 'https://www.geeksforgeeks.org/data-structures/', color: '#22d3ee' }
    ],
    'machine learning': [
        { icon: 'brain', title: 'ML Specialization – Andrew Ng', source: 'Coursera', url: 'https://www.coursera.org/specializations/machine-learning-introduction', color: '#818cf8' },
        { icon: 'flask-conical', title: 'fast.ai – Practical Deep Learning', source: 'fast.ai', url: 'https://course.fast.ai/', color: '#c084fc' },
        { icon: 'layers', title: 'Kaggle ML Courses', source: 'Kaggle', url: 'https://www.kaggle.com/learn', color: '#22d3ee' }
    ],
    'web development': [
        { icon: 'globe', title: 'The Odin Project', source: 'theodinproject.com', url: 'https://www.theodinproject.com/', color: '#fbbf24' },
        { icon: 'file-code', title: 'MDN Web Docs', source: 'Mozilla', url: 'https://developer.mozilla.org/', color: '#f472b6' },
        { icon: 'play-circle', title: 'Full Stack Open', source: 'University of Helsinki', url: 'https://fullstackopen.com/', color: '#4ade80' }
    ],
    default: [
        { icon: 'code', title: 'LeetCode — Top Interview Questions', source: 'LeetCode', url: 'https://leetcode.com/problemset/top-interview-questions/', color: '#fbbf24' },
        { icon: 'award', title: 'NPTEL Online Courses', source: 'NPTEL', url: 'https://nptel.ac.in/', color: '#818cf8' },
        { icon: 'map', title: 'CS Roadmap – roadmap.sh', source: 'roadmap.sh', url: 'https://roadmap.sh/', color: '#22d3ee' },
        { icon: 'youtube', title: 'MIT OpenCourseWare', source: 'MIT', url: 'https://ocw.mit.edu/', color: '#f87171' }
    ]
};

function renderResourceMatrix(prof) {
    const container = document.getElementById('resource-list');
    if (!container) return;

    const fav    = safeVal(prof.favorite_subject, '').toLowerCase();
    const goal   = safeVal(prof.career_goal, '').toLowerCase();
    const skills = safeVal(prof.skills, '').toLowerCase();
    const combo  = `${fav} ${goal} ${skills}`;

    let resources = RESOURCE_DB.default;
    for (const [key, val] of Object.entries(RESOURCE_DB)) {
        if (key !== 'default' && combo.includes(key)) {
            resources = val;
            break;
        }
    }

    container.innerHTML = resources.map(r => `
        <a href="${r.url}" target="_blank" rel="noopener noreferrer" class="resource-node">
            <div class="resource-icon-wrap" style="background:${r.color}22;border-color:${r.color}44">
                <i data-lucide="${r.icon}" style="width:18px;color:${r.color}"></i>
            </div>
            <div class="resource-text">
                <div class="resource-title">${r.title}</div>
                <div class="resource-source">${r.source}</div>
            </div>
            <i data-lucide="arrow-up-right" style="width:14px;color:var(--text-muted);flex-shrink:0"></i>
        </a>
    `).join('');
    if (window.lucide) lucide.createIcons();
}

// ============================================================
// FEATURE 5: PEER BENCHMARKING
// ============================================================
function renderPeerBenchmark(prof) {
    const myCgpa  = parseFloat(safeVal(prof.cgpa, '0'));
    const myAtt   = parseFloat(safeVal(prof.attendance, '0'));
    const clsCgpa = parseFloat(prof.class_avg_cgpa || 7.5);
    const clsAtt  = parseFloat(prof.class_avg_attendance || 80);

    // CGPA
    const cgpaDiff = (myCgpa - clsCgpa).toFixed(2);
    document.getElementById('bench-my-cgpa').textContent    = myCgpa.toFixed(2);
    document.getElementById('bench-class-cgpa').textContent = clsCgpa.toFixed(2);
    setBenchArrow('bench-cgpa-arrow', 'bench-cgpa-delta', cgpaDiff, 'CGPA');

    // Attendance
    const attDiff = (myAtt - clsAtt).toFixed(1);
    document.getElementById('bench-my-att').textContent    = myAtt.toFixed(1) + '%';
    document.getElementById('bench-class-att').textContent = clsAtt.toFixed(1) + '%';
    setBenchArrow('bench-att-arrow', 'bench-att-delta', attDiff, 'Att.');

    // Animate progress bars (relative to 10.0 for CGPA, 100 for attendance)
    animateBenchBar('bench-cgpa-bar', myCgpa / 10 * 100, clsCgpa / 10 * 100);
    animateBenchBar('bench-att-bar', myAtt, clsAtt);
}

function setBenchArrow(arrowId, deltaId, diff, label) {
    const arrowEl = document.getElementById(arrowId);
    const deltaEl = document.getElementById(deltaId);
    const isUp    = parseFloat(diff) >= 0;
    arrowEl.innerHTML = isUp
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    arrowEl.style.textAlign = 'center';
    const sign = parseFloat(diff) > 0 ? '+' : '';
    deltaEl.textContent = `${sign}${diff}`;
    deltaEl.style.color = isUp ? '#4ade80' : '#f87171';
    deltaEl.style.textAlign = 'center';
    deltaEl.style.fontSize = '0.82rem';
    deltaEl.style.fontWeight = '600';
    deltaEl.style.marginTop = '4px';
}

function animateBenchBar(barId, pct, avgPct) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    const isAbove = pct >= avgPct;
    bar.style.background = isAbove
        ? 'linear-gradient(90deg, rgba(129,140,248,0.3), #818cf8)'
        : 'linear-gradient(90deg, rgba(248,113,113,0.3), #f87171)';
    // Animate width
    bar.style.width = '0%';
    setTimeout(() => { bar.style.width = Math.min(pct, 100) + '%'; }, 200);
}

