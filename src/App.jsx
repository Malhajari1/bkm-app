import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported as analyticsSupported } from "firebase/analytics";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import {
  getFirestore,
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit,
  addDoc, onSnapshot, serverTimestamp, increment,
  writeBatch, runTransaction,
  arrayUnion, arrayRemove,
} from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE — config + initialization + auth/data helpers
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDJ_h6D1sxRezlmzZaSJKBwJGDauDK8Q-k",
  authDomain: "bkmapp-162b4.firebaseapp.com",
  projectId: "bkmapp-162b4",
  storageBucket: "bkmapp-162b4.firebasestorage.app",
  messagingSenderId: "73423037008",
  appId: "1:73423037008:web:d3f4cb41bde08c44d4a755",
  measurementId: "G-6CBVS82KSB",
};

const fbApp  = initializeApp(firebaseConfig);
const fbAuth = getAuth(fbApp);
const fbDb   = getFirestore(fbApp);
setPersistence(fbAuth, browserLocalPersistence).catch(()=>{});
if (typeof window !== "undefined") {
  analyticsSupported().then(ok => { if (ok) try { getAnalytics(fbApp); } catch(e){} }).catch(()=>{});
}

// Phone-as-identity helpers (workaround for not having phone OTP on Spark plan)
const normalizePhone = (raw) => {
  let p = (raw||"").replace(/[^\d+]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return "+" + p.slice(2);
  if (p.startsWith("0")) p = p.slice(1); // strip leading zero
  // If already includes Qatar country code (974), don't re-add it
  if (p.startsWith("974") && p.length >= 11) return "+" + p;
  // Default to Qatar
  if (p.length >= 7) return "+974" + p;
  return "+" + p;
};
const phoneToEmail    = (phone) => `${normalizePhone(phone).replace("+","p")}@bkm.qa`;
const phoneToPassword = (phone) => `BKM-${normalizePhone(phone)}-prototype-key-2025`;

// === Auth functions ===
const fbSignUpPhone = async (phone) => {
  const email    = phoneToEmail(phone);
  const password = phoneToPassword(phone);
  try {
    const res = await createUserWithEmailAndPassword(fbAuth, email, password);
    return { uid: res.user.uid, isNew: true, phone: normalizePhone(phone) };
  } catch (e) {
    if (e.code === "auth/email-already-in-use") {
      const res = await signInWithEmailAndPassword(fbAuth, email, password);
      return { uid: res.user.uid, isNew: false, phone: normalizePhone(phone) };
    }
    throw e;
  }
};

const fbSignInPhone = async (phone) => {
  const email    = phoneToEmail(phone);
  const password = phoneToPassword(phone);
  const res = await signInWithEmailAndPassword(fbAuth, email, password);
  return { uid: res.user.uid, phone: normalizePhone(phone) };
};

const fbSignInDev = async () => {
  const email    = "dev@bkm.qa";
  const password = "BKM-DEV-PROTOTYPE-KEY-2025";
  try {
    const res = await signInWithEmailAndPassword(fbAuth, email, password);
    return { uid: res.user.uid, isNew: false };
  } catch (e) {
    if (e.code === "auth/invalid-credential" || e.code === "auth/user-not-found" || e.code === "auth/wrong-password") {
      const res = await createUserWithEmailAndPassword(fbAuth, email, password);
      return { uid: res.user.uid, isNew: true };
    }
    throw e;
  }
};

const fbSignUpMerchant = async (email, password) => {
  const res = await createUserWithEmailAndPassword(fbAuth, email, password);
  return { uid: res.user.uid };
};

const fbSignInMerchant = async (email, password) => {
  const res = await signInWithEmailAndPassword(fbAuth, email, password);
  return { uid: res.user.uid };
};

const fbDoSignOut = () => fbSignOut(fbAuth);

// === User doc ===
const fbCreateUserDoc = async (uid, data = {}) => {
  await setDoc(doc(fbDb, "users", uid), {
    uid,
    createdAt:           serverTimestamp(),
    username:            "",
    phone:               "",
    avatar:              "a1",
    rank:                0,
    isAdmin:             false,
    isFounder:           false,
    isMerchant:          false,
    merchantName:        "",
    merchantCategory:    "",
    revealEnergy:        10,
    lastEnergyUpdate:    Date.now(),
    sharesUsedToday:     0,
    shareDateKey:        "",
    lastDailyBonusDate:  "",
    lastRevealDate:      "",
    streak:              0,
    bestStreak:          0,
    soundEnabled:        true,
    tosAccepted:         false,
    profileSetup:        false,
    tutorialSeen:        false,
    interests:           [],
    bio:                 "",
    tiktok:              "",
    instagram:           "",
    twitterX:            "",
    followers:           0,
    following:           0,
    ...data,
  }, { merge: true });
};

const fbGetUserDoc    = async (uid) => { const s = await getDoc(doc(fbDb, "users", uid)); return s.exists() ? s.data() : null; };
const fbUpdateUserDoc = (uid, patch) => updateDoc(doc(fbDb, "users", uid), patch);
const fbSubscribeUser = (uid, cb)    => onSnapshot(doc(fbDb, "users", uid), s => cb(s.exists() ? s.data() : null));

// === Username uniqueness ===
const fbCheckUsernameAvailable = async (username) => {
  const { getDocs } = await import("firebase/firestore");
  const q = query(collection(fbDb, "users"), where("username", "==", username.toLowerCase()), limit(1));
  const r = await getDocs(q);
  return r.empty;
};

// === Deals (posts) ===
const fbSubmitPost = async (postData, user) => {
  const ref = await addDoc(collection(fbDb, "deals"), {
    ...postData,
    userId:        user.uid,
    userUsername:  user.username,
    userAvatar:    user.avatar,
    userFounder:   !!user.isFounder,
    userRank:      user.rank || 0,
    claims:        0,
    ups:           0,
    downs:         0,
    verified:      false,
    status:        "pending",
    createdAt:     serverTimestamp(),
    submittedAt:   "Just now",
  });
  return ref.id;
};

const fbApprovePost = (dealId, adminUid) => updateDoc(doc(fbDb, "deals", dealId), { status:"approved", verified:true, approvedBy:adminUid, approvedAt:serverTimestamp() });
const fbRejectPost  = (dealId, adminUid) => updateDoc(doc(fbDb, "deals", dealId), { status:"rejected", rejectedBy:adminUid, rejectedAt:serverTimestamp() });

const fbSubscribeApprovedDeals = (cb) => onSnapshot(query(collection(fbDb, "deals"), where("status","==","approved"), limit(80)),
  snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a,b) => {
      const ta = a.approvedAt?.toMillis?.() || 0;
      const tb = b.approvedAt?.toMillis?.() || 0;
      return tb - ta;
    });
    cb(list);
  },
  err => { console.error("[BKM] feed subscription error:", err); cb([]); }
);
const fbSubscribePendingDeals = (cb) => onSnapshot(query(collection(fbDb, "deals"), where("status","==","pending"), limit(80)),
  snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a,b) => {
      const ta = a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toMillis?.() || 0;
      return tb - ta;
    });
    cb(list);
  },
  err => { console.error("[BKM] pending subscription error:", err); cb([]); }
);

// === Reveal / vote / bookmark / follow ===
const fbRecordReveal = async (uid, dealId) => {
  const userRef = doc(fbDb, "users", uid, "claimed", dealId);
  await setDoc(userRef, { dealId, createdAt: serverTimestamp() }, { merge:true });
  await updateDoc(doc(fbDb, "deals", dealId), { claims: increment(1) });
};

const fbRecordVote = async (uid, dealId, dir) => {
  const voteRef = doc(fbDb, "users", uid, "votes", dealId);
  const prev = await getDoc(voteRef);
  const prevDir = prev.exists() ? prev.data().dir : null;
  const dealRef = doc(fbDb, "deals", dealId);
  if (prevDir === dir) {
    // Toggling off
    await deleteDoc(voteRef);
    await updateDoc(dealRef, dir === "up" ? { ups: increment(-1) } : { downs: increment(-1) });
    return null;
  }
  await setDoc(voteRef, { dealId, dir, createdAt: serverTimestamp() }, { merge:true });
  const patch = {};
  if (prevDir === "up")    patch.ups   = increment(-1);
  if (prevDir === "down")  patch.downs = increment(-1);
  if (dir === "up")        patch.ups   = increment(prevDir === "up" ? 0 : 1);
  if (dir === "down")      patch.downs = increment(prevDir === "down" ? 0 : 1);
  await updateDoc(dealRef, patch);
  return dir;
};

const fbToggleBookmark = async (uid, dealId) => {
  const bRef = doc(fbDb, "users", uid, "bookmarks", dealId);
  const snap = await getDoc(bRef);
  if (snap.exists()) { await deleteDoc(bRef); return false; }
  await setDoc(bRef, { dealId, createdAt: serverTimestamp() });
  return true;
};

const fbToggleFollow = async (myUid, targetUid) => {
  const fRef = doc(fbDb, "users", myUid, "follows", targetUid);
  const snap = await getDoc(fRef);
  if (snap.exists()) {
    await deleteDoc(fRef);
    await updateDoc(doc(fbDb, "users", myUid), { following: increment(-1) });
    await updateDoc(doc(fbDb, "users", targetUid), { followers: increment(-1) });
    return false;
  }
  await setDoc(fRef, { targetUid, createdAt: serverTimestamp() });
  await updateDoc(doc(fbDb, "users", myUid), { following: increment(1) });
  await updateDoc(doc(fbDb, "users", targetUid), { followers: increment(1) });
  return true;
};

const fbSubscribeUserVotes     = (uid, cb) => onSnapshot(collection(fbDb, "users", uid, "votes"),     s => { const m={}; s.docs.forEach(d => m[d.id]=d.data().dir); cb(m); });
const fbSubscribeUserBookmarks = (uid, cb) => onSnapshot(collection(fbDb, "users", uid, "bookmarks"), s => cb(new Set(s.docs.map(d => d.id))));
const fbSubscribeUserClaimed   = (uid, cb) => onSnapshot(collection(fbDb, "users", uid, "claimed"),   s => cb(new Set(s.docs.map(d => d.id))));
const fbSubscribeUserFollows   = (uid, cb) => onSnapshot(collection(fbDb, "users", uid, "follows"),   s => cb(new Set(s.docs.map(d => d.id))));

// === Partner requests ===
const fbSubmitPartnerRequest = async (data) => {
  const ref = await addDoc(collection(fbDb, "partner_requests"), {
    ...data,
    status:      "pending",
    submittedAt: serverTimestamp(),
  });
  return ref.id;
};

// === Communities ===
const fbCreateCommunity = async (data, ownerUid, ownerUsername, ownerAvatar) => {
  const ref = await addDoc(collection(fbDb, "communities"), {
    name:         data.name,
    nameLower:    data.name.toLowerCase(),
    description:  data.description || "",
    rules:        data.rules || "",
    bannerColor:  data.bannerColor || "#8B0038",
    category:     data.category || "general",
    type:         data.type || "public", // public | private
    ownerUid,
    ownerUsername,
    ownerAvatar,
    memberCount:  1,
    postCount:    0,
    verified:     false,
    createdAt:    serverTimestamp(),
  });
  // Auto-join the owner
  await setDoc(doc(fbDb, "communities", ref.id, "members", ownerUid), {
    uid: ownerUid,
    role: "owner",
    joinedAt: serverTimestamp(),
    banned: false,
  });
  // Mirror to user's communities list
  await setDoc(doc(fbDb, "users", ownerUid, "communities", ref.id), {
    communityId: ref.id,
    role: "owner",
    joinedAt: serverTimestamp(),
  });
  return ref.id;
};

const fbSubscribeCommunities = (cb) => onSnapshot(query(collection(fbDb, "communities"), limit(60)),
  snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a,b) => (b.memberCount||0) - (a.memberCount||0));
    cb(list);
  },
  err => { console.error("[BKM] communities subscription error:", err); cb([]); }
);

const fbGetCommunity      = async (cid) => { const s = await getDoc(doc(fbDb, "communities", cid)); return s.exists() ? { id: s.id, ...s.data() } : null; };
const fbSubscribeCommunity = (cid, cb) => onSnapshot(doc(fbDb, "communities", cid), s => cb(s.exists() ? { id: s.id, ...s.data() } : null));

const fbCheckCommunityNameAvailable = async (name) => {
  const { getDocs } = await import("firebase/firestore");
  const q = query(collection(fbDb, "communities"), where("nameLower", "==", name.toLowerCase()), limit(1));
  const r = await getDocs(q);
  return r.empty;
};

const fbJoinCommunity = async (cid, uid) => {
  const memberRef = doc(fbDb, "communities", cid, "members", uid);
  const existing  = await getDoc(memberRef);
  if (existing.exists() && !existing.data().banned) return false; // already a member
  if (existing.exists() && existing.data().banned)  throw new Error("You are banned from this community.");
  await setDoc(memberRef, { uid, role: "member", joinedAt: serverTimestamp(), banned: false });
  await setDoc(doc(fbDb, "users", uid, "communities", cid), { communityId: cid, role: "member", joinedAt: serverTimestamp() });
  await updateDoc(doc(fbDb, "communities", cid), { memberCount: increment(1) });
  return true;
};

const fbLeaveCommunity = async (cid, uid) => {
  const memberRef = doc(fbDb, "communities", cid, "members", uid);
  const existing  = await getDoc(memberRef);
  if (!existing.exists()) return false;
  // Don't allow owners to leave (they must transfer or delete)
  if (existing.data().role === "owner") throw new Error("Owners cannot leave their community.");
  await deleteDoc(memberRef);
  await deleteDoc(doc(fbDb, "users", uid, "communities", cid));
  await updateDoc(doc(fbDb, "communities", cid), { memberCount: increment(-1) });
  return true;
};

const fbSubscribeUserCommunities = (uid, cb) => onSnapshot(collection(fbDb, "users", uid, "communities"),
  s => cb(new Map(s.docs.map(d => [d.id, d.data()]))),
  err => { console.error("[BKM] user-communities subscription error:", err); cb(new Map()); }
);

const fbSubscribeCommunityMembers = (cid, cb) => onSnapshot(collection(fbDb, "communities", cid, "members"),
  s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
  err => { console.error("[BKM] community-members subscription error:", err); cb([]); }
);

// ─────────────────────────────────────────────────────────────────────────────
// SESSION + THEME
// ─────────────────────────────────────────────────────────────────────────────

// Simple error boundary so a render crash doesn't leave a blank screen
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[BKM] render error:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding:"40px 24px", textAlign:"center", fontFamily:"'DM Sans',sans-serif", color:"#1C1208", background:"#F0E0C0", minHeight:"100vh" }}>
          <div style={{ fontSize:22, fontWeight:800, marginBottom:12 }}>Something went wrong</div>
          <div style={{ fontSize:13, color:"#6B5B4A", marginBottom:20, lineHeight:1.5 }}>The screen crashed. Tap below to recover.</div>
          <button onClick={()=>{ this.setState({ error: null }); }} style={{ padding:"12px 24px", background:"#8B0038", border:"none", borderRadius:12, color:"#FFFFFF", fontWeight:700, fontSize:14, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Try again</button>
          <div style={{ marginTop:16 }}><button onClick={()=>{ try{ fbDoSignOut(); }catch(e){} window.location.reload(); }} style={{ padding:"10px 20px", background:"transparent", border:"1px solid #C9892A", borderRadius:12, color:"#8B0038", fontWeight:600, fontSize:12, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Reload app</button></div>
        </div>
      );
    }
    return this.props.children;
  }
}
const MAX_ENERGY      = 10;
const REFILL_INTERVAL = 2 * 60 * 60 * 1000; // 1 reveal every 2 hours
const SHARE_BONUS_CAP = 3;                  // Max +3/day from sharing

const todayKey = () => new Date().toISOString().slice(0,10);

const SESSION = {
  loggedIn:false, locPerm:"pending", hasLoc:"",
  tutorialSeen:false, claimed:new Set(), tosAccepted:false,
  profileSetup:false, username:"", avatar:"a1", isAdmin:false,
  isFounder:false,
  isMerchant:false, merchantName:"", merchantCategory:"",
  interests:[],
  following:new Set(),
  feedFilter:"foryou",

  // === Reveal Energy System ===
  revealEnergy: MAX_ENERGY,            // current available reveals
  lastEnergyUpdate: Date.now(),        // last time energy was modified
  sharesUsedToday: 0,                  // counts toward SHARE_BONUS_CAP
  lastDailyBonusDate: "",              // date of last +5 daily login bonus

  // === Streak System ===
  lastRevealDate: "",                  // YYYY-MM-DD of last reveal
  streak: 0,                           // consecutive daily reveal streak
  bestStreak: 0,                       // personal best
  shareDateKey: "",                    // resets sharesUsedToday at day rollover

  // === Preferences ===
  soundEnabled: true,
};

// === Energy helpers ===
const calculateCurrentEnergy = () => {
  const now = Date.now();
  const elapsed = now - (SESSION.lastEnergyUpdate || now);
  const refills = Math.floor(elapsed / REFILL_INTERVAL);
  if (refills > 0 && SESSION.revealEnergy < MAX_ENERGY) {
    SESSION.revealEnergy = Math.min(MAX_ENERGY, SESSION.revealEnergy + refills);
    SESSION.lastEnergyUpdate = SESSION.lastEnergyUpdate + refills * REFILL_INTERVAL;
  }
  return SESSION.revealEnergy;
};

const consumeReveal = () => {
  calculateCurrentEnergy();
  if (SESSION.revealEnergy <= 0) return false;
  SESSION.revealEnergy -= 1;
  if (SESSION.revealEnergy === MAX_ENERGY - 1) SESSION.lastEnergyUpdate = Date.now(); // start refill clock
  persistSession();
  return true;
};

const earnReveals = (amount) => {
  calculateCurrentEnergy();
  SESSION.revealEnergy = Math.min(MAX_ENERGY, SESSION.revealEnergy + amount);
  persistSession();
  return SESSION.revealEnergy;
};

const claimDailyBonus = () => {
  const today = todayKey();
  if (SESSION.lastDailyBonusDate === today) return 0;
  SESSION.lastDailyBonusDate = today;
  earnReveals(5);
  return 5;
};

const tryShareBonus = () => {
  const today = todayKey();
  if (SESSION.shareDateKey !== today) {
    SESSION.shareDateKey = today;
    SESSION.sharesUsedToday = 0;
  }
  if (SESSION.sharesUsedToday >= SHARE_BONUS_CAP) return 0;
  SESSION.sharesUsedToday += 1;
  earnReveals(1);
  return 1;
};

const getTimeToNextRefill = () => {
  if (SESSION.revealEnergy >= MAX_ENERGY) return null;
  const now = Date.now();
  const elapsed = now - (SESSION.lastEnergyUpdate || now);
  const remaining = REFILL_INTERVAL - (elapsed % REFILL_INTERVAL);
  const totalSecs = Math.max(0, Math.floor(remaining / 1000));
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// === Streak helpers ===
const updateStreakOnReveal = () => {
  const today = todayKey();
  const last  = SESSION.lastRevealDate;
  if (last === today) return; // already counted today
  if (!last) { SESSION.streak = 1; }
  else {
    const lastDate  = new Date(last);
    const todayDate = new Date(today);
    const diffDays  = Math.round((todayDate - lastDate) / (1000*60*60*24));
    if (diffDays === 1) SESSION.streak += 1;
    else                SESSION.streak  = 1; // broken
  }
  SESSION.lastRevealDate = today;
  if (SESSION.streak > SESSION.bestStreak) SESSION.bestStreak = SESSION.streak;
  persistSession();
};

// === Persistence — keep streak / energy / sound across refreshes ===
const PERSIST_KEY = "bkm_session_v1";
const persistSession = () => {
  try {
    if (typeof window === "undefined") return;
    const data = {
      revealEnergy:       SESSION.revealEnergy,
      lastEnergyUpdate:   SESSION.lastEnergyUpdate,
      sharesUsedToday:    SESSION.sharesUsedToday,
      lastDailyBonusDate: SESSION.lastDailyBonusDate,
      lastRevealDate:     SESSION.lastRevealDate,
      streak:             SESSION.streak,
      bestStreak:         SESSION.bestStreak,
      shareDateKey:       SESSION.shareDateKey,
      soundEnabled:       SESSION.soundEnabled,
    };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
  } catch(e){}
};
const restoreSession = () => {
  try {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(SESSION, data);
  } catch(e){}
};
restoreSession();

// Shared mutable lists (in production: Firestore collections)
const PARTNER_REQUESTS = [];   // partner inquiry submissions
const MERCHANT_LISTINGS = [];  // products posted by merchants

// Current logged-in user — set at login time, not hardcoded
let CURRENT_USER = null;

// ─────────────────────────────────────────────────────────────────────────────
// SOUND EFFECTS — Web Audio synthesis (no files, no copyright, instant)
// ─────────────────────────────────────────────────────────────────────────────
let _audioCtx = null;
const getAudio = () => {
  if (typeof window === "undefined") return null;
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){ return null; }
  }
  if (_audioCtx.state === "suspended") _audioCtx.resume().catch(()=>{});
  return _audioCtx;
};

const playTone = (freq, durationMs, type="sine", peakGain=0.07, freqEnd=null) => {
  if (!SESSION.soundEnabled) return;
  const ctx = getAudio();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime;
    const dur = durationMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peakGain, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch(e){}
};

const sfx = {
  reveal:    () => { playTone(800, 90, "sine", 0.10, 1400); setTimeout(()=>playTone(1500, 70, "sine", 0.06), 90); },
  earn:      () => { [800,1000,1300].forEach((f,i)=>setTimeout(()=>playTone(f, 60, "triangle", 0.07), i*55)); },
  voteUp:    () => playTone(700, 80, "sine", 0.08, 950),
  voteDown:  () => playTone(380, 100, "sine", 0.07, 280),
  bookmark:  () => playTone(1500, 50, "sine", 0.06),
  success:   () => { [523,659,784].forEach((f,i)=>setTimeout(()=>playTone(f, 90, "triangle", 0.06), i*65)); },
  error:     () => playTone(380, 180, "sine", 0.05, 250),
  tap:       () => playTone(1800, 14, "sine", 0.025),
  streak:    () => { [659,784,988,1175].forEach((f,i)=>setTimeout(()=>playTone(f, 80, "triangle", 0.07), i*70)); },
  whoosh:    () => playTone(2200, 60, "sine", 0.04, 800),
};

const getMe = () => CURRENT_USER || ME;

// ── Taken usernames (in production: Firestore query) ──
const TAKEN_USERNAMES = ["swiss","dealhunterq","pearlfinds","dohadeals_","lusaillooks","newhunter99","admin","bkm","founder","official","moderator","support","help","doha","qatar","merchant","merchants","partner","partners","staff","team"];

// ── Beta tester badge tiers (based on signup order) ──
const BETA_TIERS = [
  { limit:10,  label:"OG",        color:"#FFD700", bg:"#FFD70018", border:"#FFD70055", desc:"First 10"    },
  { limit:35,  label:"PIONEER",   color:"#C0C0C0", bg:"#C0C0C018", border:"#C0C0C055", desc:"First 35"    },
  { limit:100, label:"EARLY",     color:"#CD7F32", bg:"#CD7F3218", border:"#CD7F3255", desc:"First 100"   },
];

// Simulate beta signup order (in production: stored in Firestore)
const USER_BETA_ORDER = { 0:1, 1:8, 2:22, 3:45, 4:88 }; // ME=1, users by index

const getBetaBadge = (userId) => {
  const order = USER_BETA_ORDER[userId];
  if (!order) return null;
  if (order <= 10)  return BETA_TIERS[0];
  if (order <= 35)  return BETA_TIERS[1];
  if (order <= 100) return BETA_TIERS[2];
  return null;
};

// ── Post card banner tiers based on rank + engagement ──
const getPostBanner = (deal) => {
  const ratio = deal.ups / Math.max(1, deal.ups + deal.downs);
  const claims = deal.claims;
  if (deal.user.founder)               return { label:"FOUNDER",    grad:"linear-gradient(90deg,#1D6FEB,#56B0FF)" };
  if (deal.user.rank===4 && ratio>0.9) return { label:"ELITE PICK", grad:"linear-gradient(90deg,#8B0038,#C9892A,#FFD700)" };
  if (claims>300 && ratio>0.85)        return { label:"TRENDING",   grad:"linear-gradient(90deg,#FF6B35,#FFB347)" };
  if (claims>100 && ratio>0.85)        return { label:"HOT",        grad:"linear-gradient(90deg,#8B0038,#D4A24C)" };
  if (deal.verified && ratio>0.9)      return { label:"TRUSTED",    grad:"linear-gradient(90deg,#16A34A,#34D399)" };
  return null;
};
const BAD_WORDS = [
  "fuck","shit","ass","bitch","bastard","damn","crap","piss","cock","dick","pussy","cunt","whore","slut","fag","nigger","nigga","retard","faggot","motherfucker","asshole","bullshit","jackass","wanker","twat","bollocks","prick","arsehole","shithead","dumbass","dipshit","douchebag","fucker","idiot","stupid","moron","imbecile","loser","hate","kill","sex","porn","nude","naked","rape","pedophile","terrorist",
  // leet speak variants covered by the normalizer
  "f4ck","sh1t","b1tch","a55","d1ck","p0rn",
  // Arabic profanity (transliterated)
  "kuss","kes","kos","khara","sharmouta","ibn el sharmouta","kalb","khawal","kafir","ibn haram","zibbi","ayr","zift","ibn el",
];
const hasBadWord = (str) => {
  const clean = str.toLowerCase()
    .replace(/\s+/g,"")
    .replace(/[@4]/g,"a")
    .replace(/[0]/g,"o")
    .replace(/[1!|]/g,"i")
    .replace(/[3]/g,"e")
    .replace(/[$5]/g,"s")
    .replace(/[7]/g,"t")
    .replace(/[9]/g,"g")
    .replace(/[6]/g,"b")
    .replace(/[+]/g,"t")
    .replace(/[*_.,-]/g,"");
  return BAD_WORDS.some(w => {
    const wClean = w.toLowerCase().replace(/\s+/g,"");
    return clean.includes(wClean);
  });
};
const isValidUsername = (u) => {
  if (!u || u.length < 3 || u.length > 20) return "3–20 characters required";
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(u)) return "Letters, numbers and _ only. Must start with a letter";
  if (["bkm","admin","official","moderator","support"].some(x=>u.toLowerCase().includes(x))) return "Username not allowed";
  if (hasBadWord(u)) return "Username contains disallowed content";
  return null; // valid
};
const getAuto = () => new Date().getHours() >= 7 && new Date().getHours() < 19 ? "light" : "dark";
const TH = {
  dark:  { bg:"#07060A", surface:"#0F0C08", border:"#1E1810", text:"#F0E0C0", sub:"#5A4530", muted:"#141008", accent:"#8B0038", btnBg:"#F0E0C0", btnText:"#07060A", inputBg:"#0F0C08", inputBorder:"#1E1810", pill:"#161008", pillBorder:"#221810", card:"#0F0C08" },
  light: { bg:"#F5F0E8", surface:"#FFFFFF",  border:"#EAE0D0", text:"#1C1208", sub:"#AE9878", muted:"#EAE0D0", accent:"#8B0038", btnBg:"#1C1208", btnText:"#F5F0E8", inputBg:"#FFFFFF",  inputBorder:"#EAE0D0", pill:"#EEE8DC", pillBorder:"#E0D4C0", card:"#FFFFFF" },
};

// ─────────────────────────────────────────────────────────────────────────────
// RANK SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
const RANKS = [
  { tier:0, label:"Scout"   },
  { tier:1, label:"Finder"  },
  { tier:2, label:"Hunter"  },
  { tier:3, label:"Tracker" },
  { tier:4, label:"Elite"   },
];

const RANK_LABELS = ["Scout","Finder","Hunter","Tracker","Elite"];
const RANK_COLORS = ["#A0907A","#6B5B4A","#8B0038","#FFFFFF","#FFFFFF"];

// Qatar districts
const AREAS = ["The Pearl","West Bay","Lusail","Al Waab","Msheireb","Al Hilal","Madinat Khalifa","Al Sadd","Old Airport","Al Wakra"];

// ─────────────────────────────────────────────────────────────────────────────
// TIER BADGE — Option B (BKM Brand Ladder)
// Visually escalates: dashed outline → solid outline → tinted maroon → solid maroon → maroon-to-gold gradient
// Founder gets the blue gradient (separate from the credibility ladder)
// ─────────────────────────────────────────────────────────────────────────────
const TIER_STYLES = [
  // 0 SCOUT — outlined dashed (lightest)
  { background:"transparent", color:"#A0907A", border:"1px dashed #A0907A" },
  // 1 FINDER — solid outline
  { background:"transparent", color:"#6B5B4A", border:"1px solid #A0907A" },
  // 2 HUNTER — tinted maroon
  { background:"rgba(139,0,56,0.10)", color:"#8B0038", border:"1px solid rgba(139,0,56,0.27)" },
  // 3 TRACKER — solid maroon
  { background:"#8B0038", color:"#FFFFFF", border:"1px solid #8B0038" },
  // 4 ELITE — maroon to gold gradient (most premium credibility tier)
  { background:"linear-gradient(135deg,#8B0038,#C9892A)", color:"#FFFFFF", border:"1px solid transparent" },
];

const FOUNDER_STYLE = { background:"linear-gradient(135deg,#1D6FEB,#56B0FF)", color:"#FFFFFF", border:"1px solid transparent" };

function TierBadge({ user, size="sm" }) {
  const isFounder = user?.founder;
  const tier = user?.rank ?? 0;
  const style = isFounder ? FOUNDER_STYLE : TIER_STYLES[Math.max(0, Math.min(4, tier))];
  const label = isFounder ? "FOUNDER" : (RANK_LABELS[tier] || "Scout").toUpperCase();
  const dims = size === "sm"
    ? { fontSize:9,  padding:"2px 7px", borderRadius:5,  letterSpacing:"0.06em" }
    : { fontSize:10, padding:"3px 9px", borderRadius:6,  letterSpacing:"0.08em" };
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:4, lineHeight:1.5,
      fontFamily:"'DM Sans',sans-serif", fontWeight:800,
      ...dims, ...style,
    }}>{label}</span>
  );
}

function getRankBorderStyle(tier) {
  if (tier === 0) return { border:"1px solid #2A2018",      shadow:"none",                            grad:null };
  if (tier === 1) return { border:"1.5px solid #8B003855",  shadow:"none",                            grad:null };
  if (tier === 2) return { border:"2px solid #8B0038",      shadow:"0 0 10px #8B003828",              grad:null };
  if (tier === 3) return { border:"none",                   shadow:"0 0 16px #8B003840",              grad:"linear-gradient(135deg,#8B0038,#C9892A)" };
  if (tier === 4) return { border:"none",                   shadow:"0 0 22px #8B003855",              grad:"animated" };
  return { border:"1px solid #2A2018", shadow:"none", grad:null };
}

function getRingStyle(tier) {
  if (tier === 0) return { background:"#2A2018" };
  if (tier === 1) return { background:"#8B003855" };
  if (tier === 2) return { background:"#8B0038" };
  if (tier === 3) return { background:"linear-gradient(135deg,#8B0038,#C9892A)" };
  if (tier === 4) return { background:"linear-gradient(135deg,#8B0038,#C9892A,#FFD700,#8B0038)" };
  return { background:"#2A2018" };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────
const CATS = [
  { key:"food",        label:"Food"        },
  { key:"groceries",   label:"Groceries"   },
  { key:"stores",      label:"Stores"      },
  { key:"electronics", label:"Electronics" },
  { key:"flowers",     label:"Flowers"     },
  { key:"pharmacies",  label:"Pharmacies"  },
];

const PLATFORMS = {
  talabat: { color:"#FF6B35", label:"Talabat" },
  snoonu:  { color:"#7C3AED", label:"Snoonu"  },
  careem:  { color:"#16A34A", label:"Careem"  },
  rafeeq:  { color:"#0284C7", label:"Rafeeq"  },
};

const DISTRICTS = ["The Pearl","West Bay","Lusail","Al Waab","Msheireb","Al Hilal","Madinat Khalifa","Al Sadd","Old Airport","Al Wakra","Lagoon","Barwa City"];

const OB_QS = [
  { a:"Pizza",   b:"Milkshake"   },
  { a:"Pasta",   b:"Gaming"      },
  { a:"Panadol", b:"Anvil"       },
  { a:"Coffee",  b:"Fresh Juice" },
  { a:"Sushi",   b:"Biryani"     },
];

const USERS = [
  { id:1, username:"DealHunterQ",  name:null,    av:"31",  rank:4, founder:false, caption:"Finding deals so you don't have to",  deals:142, followers:0, following:0 },
  { id:2, username:"PearlFinds",   name:"Sara",  av:"64",  rank:3, founder:false, caption:"West Bay & Pearl specialist",          deals:67,  followers:0, following:0 },
  { id:3, username:"DohaDeals_",   name:null,    av:"91",  rank:2, founder:false, caption:"Daily deals across Doha",              deals:34,  followers:0, following:0 },
  { id:4, username:"LusailLooks",  name:"Ahmed", av:"22",  rank:1, founder:false, caption:"Lusail & North Qatar",                 deals:12,  followers:0, following:0 },
  { id:5, username:"NewHunter99",  name:null,    av:"45",  rank:0, founder:false, caption:"",                                     deals:2,   followers:0, following:0 },
];

const ME = { id:0, username:"SWISS", name:"SWISS", av:"77", rank:2, founder:true, caption:"BKM Co-Founder · بكم", deals:5, followers:0, following:0 };

const DEALS = [
  { id:1,  subject:"This shawarma spot is criminally underrated. Been eating here for years and the price has not moved. Proper quality.", user:USERS[0], cat:"food",        platform:"snoonu",  district:"Al Wakra",   place:"Al Wakra Shawarma Palace",   address:"Street 4, Al Wakra",               items:[{n:"Chicken Shawarma",p:8},{n:"Meat Shawarma",p:10},{n:"Fresh Juice",p:5}],               ups:847,  downs:23, claims:312, time:"2h",  verified:true,  img:"https://picsum.photos/seed/sw1/300/140" },
  { id:2,  subject:"Stocked up my entire week for under QAR 80. Al Meera Msheireb is sleeping on everyone right now.",                   user:USERS[1], cat:"groceries",   platform:"careem",  district:"Msheireb",   place:"Al Meera Msheireb",          address:"Msheireb Downtown",                items:[{n:"Basmati Rice 5kg",p:17},{n:"Organic Eggs x12",p:11},{n:"Labneh 500g",p:7.5},{n:"Olive Oil 750ml",p:26}], ups:534, downs:41, claims:198, time:"4h",  verified:true,  img:"https://picsum.photos/seed/gr2/300/140" },
  { id:3,  subject:"Adidas Samba for QAR 399. Last time I saw these for this price was 2021. Go now before they are gone.",               user:USERS[2], cat:"stores",      platform:"store",   district:"Lusail",     place:"Adidas Lusail City Centre",  address:"Lusail City Centre, Level 1",      items:[{n:"Adidas Samba White",p:399},{n:"Adidas Gazelle Navy",p:449}],                          ups:1203, downs:87, claims:445, time:"6h",  verified:true,  img:"https://picsum.photos/seed/ad3/300/140" },
  { id:4,  subject:"Paracetamol price check across 3 pharmacies on the same street. The gap is wild.",                                    user:USERS[3], cat:"pharmacies",  platform:"rafeeq",  district:"Al Sadd",    place:"Life Pharmacy Al Sadd",      address:"Al Sadd Street, near Lulu",        items:[{n:"Paracetamol 500mg x20",p:3.5},{n:"Ibuprofen 400mg x24",p:7},{n:"Vitamin C 1000mg",p:18}], ups:289, downs:12, claims:167, time:"8h",  verified:true,  img:"https://picsum.photos/seed/ph4/300/140" },
  { id:5,  subject:"Same quality as Apple, quarter of the price. Tested it for three weeks straight, zero issues.",                       user:USERS[4], cat:"electronics", platform:"snoonu", district:"West Bay",   place:"Virgin Megastore DFC",       address:"Doha Festival City, Ground Floor", items:[{n:"65W USB-C Charger",p:45},{n:"USB-C Cable 2m",p:18}],                                    ups:156,  downs:34, claims:89,  time:"1d",  verified:true,  img:"https://picsum.photos/seed/el5/300/140" },
  { id:6,  subject:"Ordered these roses and they are still fresh five days later. The standard bouquet has fourteen stems.",               user:USERS[1], cat:"flowers",     platform:"snoonu", district:"The Pearl",  place:"Doha Blooms The Pearl",      address:"Porto Arabia, The Pearl",          items:[{n:"Red Roses x12",p:65},{n:"Mixed Bouquet",p:55},{n:"White Lilies x6",p:70}],             ups:412,  downs:8,  claims:203, time:"1d",  verified:true,  img:"https://picsum.photos/seed/fl6/300/140" },
  { id:7,  subject:"Best flat white in Doha and nobody is talking about it. Tiny spot, massive flavour.",                                 user:USERS[0], cat:"food",        platform:"store",  district:"Al Waab",    place:"Craft Coffee Co. Al Waab",   address:"Al Waab Street, near Villaggio",   items:[{n:"Flat White",p:14},{n:"Cold Brew",p:16},{n:"Croissant",p:8}],                            ups:623,  downs:18, claims:241, time:"3h",  verified:true,  img:"https://picsum.photos/seed/cf7/300/140" },
  { id:8,  subject:"Nike Air Force just dropped to QAR 380. That is the lowest I have seen them in Qatar.",                               user:USERS[2], cat:"stores",      platform:"talabat",district:"Lusail",     place:"Nike Lusail City Centre",    address:"Lusail City Centre, Ground Floor", items:[{n:"Nike Air Force 1 White",p:380},{n:"Nike Air Max",p:420}],                               ups:891,  downs:52, claims:387, time:"5h",  verified:true,  img:"https://picsum.photos/seed/nk8/300/140" },
  { id:9,  subject:"Biryani that actually tastes like home. Huge portion. Been going every week for a month.",                             user:USERS[3], cat:"food",        platform:"snoonu", district:"Al Hilal",   place:"Hyderabadi Kitchen",         address:"Al Hilal, near Al Meera",          items:[{n:"Chicken Biryani Full",p:22},{n:"Mutton Biryani",p:28},{n:"Raita",p:3}],                 ups:445,  downs:21, claims:178, time:"12h", verified:true,  img:"https://picsum.photos/seed/by9/300/140" },
  { id:10, subject:"Vitamin D and Omega together under QAR 50 at Al Dawaa. I paid double at Boots last month.",                            user:USERS[1], cat:"pharmacies",  platform:"rafeeq", district:"Madinat Khalifa", place:"Al Dawaa Madinat Khalifa", address:"Madinat Khalifa Main St",        items:[{n:"Vitamin D3 1000IU",p:19},{n:"Omega-3 Fish Oil",p:28}],                                 ups:318,  downs:15, claims:143, time:"14h", verified:true,  img:"https://picsum.photos/seed/vt10/300/140" },
  { id:11, subject:"AirPods Gen 3 from Apple Store with full warranty. Price matched online. No grey market stress.",                      user:USERS[0], cat:"electronics", platform:"store",  district:"West Bay",   place:"Apple Store Doha Festival City", address:"Doha Festival City, Level 1",  items:[{n:"AirPods Gen 3",p:549},{n:"AirPods Pro 2",p:849}],                                      ups:567,  downs:44, claims:234, time:"18h", verified:true,  img:"https://picsum.photos/seed/ap11/300/140" },
  { id:12, subject:"Orchid plant that has been alive for two months now. Strong recommendation for gifts.",                                user:USERS[2], cat:"flowers",     platform:"snoonu", district:"The Pearl",  place:"Green Corner The Pearl",     address:"The Pearl, Zone 60",               items:[{n:"Orchid Plant",p:85},{n:"Succulent Set",p:45}],                                          ups:198,  downs:9,  claims:87,  time:"20h", verified:true,  img:"https://picsum.photos/seed/fl12/300/140" },
  { id:13, subject:"Carrefour has the best olive oil price in Doha right now. Checked all three branches.",                                user:USERS[4], cat:"groceries",   platform:"careem", district:"Al Sadd",   place:"Carrefour Al Sadd",          address:"Al Sadd, near City Center",        items:[{n:"Extra Virgin Olive Oil 1L",p:22},{n:"Sunflower Oil 2L",p:14}],                           ups:234,  downs:28, claims:112, time:"22h", verified:true,  img:"https://picsum.photos/seed/cv13/300/140" },
  { id:14, subject:"SPF fifty sunscreen at less than half the price of Boots. Same brand, bought directly from Life Pharmacy Al Wakra.",   user:USERS[3], cat:"pharmacies",  platform:"store",  district:"Al Wakra",  place:"Life Pharmacy Al Wakra",     address:"Al Wakra, near Grand Mall",        items:[{n:"Sunscreen SPF50 200ml",p:28},{n:"After Sun Lotion",p:18}],                               ups:167,  downs:11, claims:76,  time:"1d",  verified:true,  img:"https://picsum.photos/seed/sp14/300/140" },
];

// Pending posts awaiting BKM review
const PENDING_POSTS_INIT = [
  { id:101, subject:"Costa at Lusail cheaper than every other Costa in Doha. Checked three branches.", user:USERS[4], cat:"food",       platform:"store",   district:"Lusail",    place:"Costa Coffee Lusail", address:"Lusail Blvd, near Marina", items:[{n:"Americano Large",p:16},{n:"Latte Medium",p:18}], submitted:"Just now",  img:"https://picsum.photos/seed/pnd1/300/140" },
  { id:102, subject:"Lulu has the cheapest eggs in Doha right now by a big margin.",                   user:USERS[2], cat:"groceries", platform:"talabat", district:"Al Waab",   place:"Lulu Hypermarket Al Waab", address:"Al Waab St", items:[{n:"Free Range Eggs x12",p:9.5},{n:"Regular Eggs x12",p:6}], submitted:"5 min ago", img:"https://picsum.photos/seed/pnd2/300/140" },
  { id:103, subject:"New pharmacy opened in Msheireb. Prices across the board lower than Al Dawaa.",   user:USERS[1], cat:"pharmacies",platform:"store",   district:"Msheireb",  place:"Nahdi Pharmacy Msheireb", address:"Msheireb Downtown", items:[{n:"Panadol Extra x24",p:12},{n:"Cetaphil Moisturiser",p:38}], submitted:"12 min ago",img:"https://picsum.photos/seed/pnd3/300/140" },
];

const HINTS = ["Chicken Shawarma","Paracetamol 500mg","iPhone 15 charger","Basmati Rice 5kg","Red Roses bouquet","Smash Burger","Vitamin D3 1000IU","Adidas Samba White","Chicken Biryani","Organic Milk 1L","AirPods Gen 3","Margherita Pizza","Omega-3 Fish Oil","Nike Air Force 1","Mixed Flower Bouquet","Grilled Salmon","USB-C Charger 65W","Free Range Eggs x12","Sunscreen SPF50","Extra Virgin Olive Oil"];

const NEARBY = [
  { name:"Al Wakra Shawarma Palace", district:"Al Wakra",  cat:"food",       topItem:"Chicken Shawarma", price:8,   platform:"snoonu", deals:5, img:"https://picsum.photos/seed/nb1/280/110" },
  { name:"Life Pharmacy Al Sadd",    district:"Al Sadd",   cat:"pharmacies", topItem:"Paracetamol 20s",  price:3.5, platform:"rafeeq", deals:3, img:"https://picsum.photos/seed/nb2/280/110" },
  { name:"Al Meera Msheireb",        district:"Msheireb",  cat:"groceries",  topItem:"Basmati Rice 5kg", price:17,  platform:"careem", deals:8, img:"https://picsum.photos/seed/nb3/280/110" },
  { name:"Adidas Lusail City Centre",district:"Lusail",    cat:"stores",     topItem:"Adidas Samba",     price:399, platform:"careem", deals:2, img:"https://picsum.photos/seed/nb4/280/110" },
  { name:"Doha Blooms The Pearl",    district:"The Pearl", cat:"flowers",    topItem:"Red Roses x12",    price:65,  platform:"snoonu", deals:4, img:"https://picsum.photos/seed/nb5/280/110" },
];

const TOP5_SEARCH = [
  { name:"Chicken Shawarma",      platform:"snoonu",  price:8,   vendor:"Al Wakra Shawarma Palace", postedBy:"DealHunterQ", rank:4 },
  { name:"Paracetamol 500mg x20", platform:"rafeeq",  price:3.5, vendor:"Life Pharmacy Al Sadd",    postedBy:"PearlFinds",  rank:3 },
  { name:"Adidas Samba White",    platform:"careem",  price:399, vendor:"Adidas Lusail",             postedBy:"DohaDeals_",  rank:2 },
  { name:"Basmati Rice 5kg",      platform:"careem",  price:17,  vendor:"Al Meera Msheireb",         postedBy:"LusailLooks", rank:1 },
  { name:"Red Roses x12",         platform:"snoonu",  price:65,  vendor:"Doha Blooms The Pearl",     postedBy:"DealHunterQ", rank:4 },
];

const SEARCH_RESULTS = {
  shawarma: [
    { vendor:"Al Wakra Shawarma Palace", item:"Chicken Shawarma", platform:"snoonu",  price:8,   deliveryFee:5,  rating:4.8, verified:true,  postedBy:"DealHunterQ", rank:4, img:"https://picsum.photos/seed/sr1/56/56" },
    { vendor:"Lebanese House",           item:"Chicken Shawarma", platform:"rafeeq",  price:12,  deliveryFee:0,  rating:4.5, verified:true,  postedBy:"PearlFinds",  rank:3, img:"https://picsum.photos/seed/sr2/56/56" },
    { vendor:"Shawarma Station",         item:"Chicken Shawarma", platform:"talabat", price:14,  deliveryFee:8,  rating:4.6, verified:true,  postedBy:"DohaDeals_",  rank:2, img:"https://picsum.photos/seed/sr3/56/56" },
    { vendor:"Sultan's Kitchen",         item:"Chicken Shawarma", platform:"careem",  price:18,  deliveryFee:0,  rating:4.3, verified:false, postedBy:"NewHunter99", rank:0, img:"https://picsum.photos/seed/sr4/56/56" },
  ],
  paracetamol: [
    { vendor:"Life Pharmacy Al Sadd",    item:"Paracetamol 500mg x20", platform:"rafeeq",  price:3.5, deliveryFee:0,  rating:4.9, verified:true,  postedBy:"DealHunterQ", rank:4, img:"https://picsum.photos/seed/sr5/56/56" },
    { vendor:"Al Dawaa Pharmacy",        item:"Paracetamol 500mg x20", platform:"snoonu",  price:5,   deliveryFee:5,  rating:4.4, verified:true,  postedBy:"LusailLooks", rank:1, img:"https://picsum.photos/seed/sr6/56/56" },
    { vendor:"Boots The Pearl",          item:"Paracetamol 500mg x20", platform:"careem",  price:6.5, deliveryFee:0,  rating:4.6, verified:true,  postedBy:"PearlFinds",  rank:3, img:"https://picsum.photos/seed/sr7/56/56" },
    { vendor:"Care Pharmacy",            item:"Paracetamol 500mg x20", platform:"talabat", price:7,   deliveryFee:8,  rating:4.2, verified:false, postedBy:"NewHunter99", rank:0, img:"https://picsum.photos/seed/sr8/56/56" },
  ],
  burger: [
    { vendor:"Burger Boutique",          item:"Classic Smash Burger",  platform:"careem",  price:26,  deliveryFee:0,  rating:4.9, verified:true,  postedBy:"DohaDeals_",  rank:2, img:"https://picsum.photos/seed/sr9/56/56"  },
    { vendor:"The Burger Corner",        item:"Double Beef Burger",    platform:"snoonu",  price:32,  deliveryFee:5,  rating:4.4, verified:true,  postedBy:"PearlFinds",  rank:3, img:"https://picsum.photos/seed/sr10/56/56" },
    { vendor:"Five Guys Qatar",          item:"Little Hamburger",      platform:"talabat", price:35,  deliveryFee:10, rating:4.6, verified:true,  postedBy:"DealHunterQ", rank:4, img:"https://picsum.photos/seed/sr11/56/56" },
    { vendor:"Johnny Rockets",           item:"Original Burger",       platform:"rafeeq",  price:38,  deliveryFee:0,  rating:4.2, verified:false, postedBy:"LusailLooks", rank:1, img:"https://picsum.photos/seed/sr12/56/56" },
  ],
  samba: [
    { vendor:"Adidas Lusail City Centre",item:"Adidas Samba White",    platform:"careem",  price:399, deliveryFee:0,  rating:4.8, verified:true,  postedBy:"DohaDeals_",  rank:2, img:"https://picsum.photos/seed/sr13/56/56" },
    { vendor:"Adidas The Pearl",         item:"Adidas Samba Navy",     platform:"snoonu",  price:420, deliveryFee:15, rating:4.6, verified:true,  postedBy:"PearlFinds",  rank:3, img:"https://picsum.photos/seed/sr14/56/56" },
    { vendor:"Stadium Qatar",            item:"Adidas Samba OG",       platform:"talabat", price:449, deliveryFee:0,  rating:4.4, verified:false, postedBy:"LusailLooks", rank:1, img:"https://picsum.photos/seed/sr15/56/56" },
  ],
};

const SUGGESTIONS = ["Chicken Shawarma","Paracetamol 500mg","Smash Burger","Basmati Rice 5kg","Adidas Samba White","Vitamin D3 1000IU","AirPods Gen 3","Red Roses x12","Grilled Salmon","Coffee Flat White"];

// ─────────────────────────────────────────────────────────────────────────────
// HOOK — typing animation
// ─────────────────────────────────────────────────────────────────────────────
function useTyping(phrases) {
  const [display, setDisplay] = useState("");
  const st = useRef({ pi:0, ci:0, del:false });
  const tm = useRef(null);
  useEffect(() => {
    const tick = () => {
      const { pi, ci, del } = st.current;
      const word = phrases[pi];
      if (!del) {
        if (ci < word.length) { st.current.ci++; setDisplay(word.slice(0, st.current.ci)); tm.current = setTimeout(tick, 85); }
        else { tm.current = setTimeout(() => { st.current.del = true; tick(); }, 3000); }
      } else {
        if (ci > 0) { st.current.ci--; setDisplay(word.slice(0, st.current.ci)); tm.current = setTimeout(tick, 38); }
        else { st.current.pi = (pi+1)%phrases.length; st.current.ci=0; st.current.del=false; tm.current = setTimeout(tick, 400); }
      }
    };
    tm.current = setTimeout(tick, 600);
    return () => clearTimeout(tm.current);
  }, []);
  return display;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// Tag mark
function TagMark({ size=80, fill, holeBg }) {
  const W=size*1.55, H=size, r=H*0.18, tip=W*0.22, hR=H*0.11, hCx=tip*0.62, hCy=H/2;
  const p=[`M${tip} 0`,`L${W-r} 0`,`Q${W} 0 ${W} ${r}`,`L${W} ${H-r}`,`Q${W} ${H} ${W-r} ${H}`,`L${tip} ${H}`,`L0 ${H/2}`,`Z`].join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
      <defs><mask id="tmh"><rect width={W} height={H} fill="white"/><circle cx={hCx} cy={hCy} r={hR} fill="black"/></mask></defs>
      <path d={p} fill={fill} mask="url(#tmh)"/>
      <circle cx={hCx} cy={hCy} r={hR} stroke={holeBg} strokeWidth={H*0.028} fill="none"/>
      <line x1={W*0.35} y1={H*0.80} x2={W*0.78} y2={H*0.80} stroke="#8B0038" strokeWidth={H*0.042} strokeLinecap="round"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR AVATAR — generated from username, no external images
// ─────────────────────────────────────────────────────────────────────────────
const AVATAR_PALETTE = [
  { bg:"#8B0038", fg:"#FFFFFF" },
  { bg:"#1D6FEB", fg:"#FFFFFF" },
  { bg:"#16A34A", fg:"#FFFFFF" },
  { bg:"#F59E0B", fg:"#1C1208" },
  { bg:"#7C3AED", fg:"#FFFFFF" },
  { bg:"#EC4899", fg:"#FFFFFF" },
  { bg:"#0EA5E9", fg:"#FFFFFF" },
  { bg:"#84CC16", fg:"#1C1208" },
  { bg:"#F97316", fg:"#FFFFFF" },
  { bg:"#06B6D4", fg:"#FFFFFF" },
  { bg:"#A855F7", fg:"#FFFFFF" },
  { bg:"#DC2626", fg:"#FFFFFF" },
];
const colorFromSeed = (seed) => {
  const s = String(seed||"X");
  let h=0; for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
};
const initialFrom = (str) => (String(str||"?").trim()[0] || "?").toUpperCase();

function ColorAvatar({ user, size=38 }) {
  const seed = user?.av || user?.username || "X";
  const col  = colorFromSeed(seed);
  const init = initialFrom(user?.username);
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:col.bg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontFamily:"'DM Sans',sans-serif" }}>
      <span style={{ fontSize:size*0.42, fontWeight:800, color:col.fg, lineHeight:1 }}>{init}</span>
    </div>
  );
}

// Avatar with rank ring + founder badge
function Avatar({ user, size=38 }) {
  const isFounder = user?.founder;
  const ringBg = isFounder
    ? "linear-gradient(135deg,#1D6FEB,#56B0FF)"
    : getRingStyle(user.rank).background;
  const seed = user?.av || user?.username || "X";
  const col  = (typeof colorFromSeed === "function") ? colorFromSeed(seed) : { bg:"#8B0038", fg:"#FFFFFF" };
  const init = (user?.username||"?").trim()[0]?.toUpperCase() || "?";
  return (
    <div style={{ width:size+4, height:size+4, borderRadius:"50%", padding:2, background:ringBg, flexShrink:0, position:"relative" }}>
      <div style={{ width:size, height:size, borderRadius:"50%", background:col.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontSize:size*0.42, fontWeight:800, color:col.fg, fontFamily:"'DM Sans',sans-serif", lineHeight:1 }}>{init}</span>
      </div>
      {isFounder && (
        <div style={{ position:"absolute", bottom:-1, right:-1, width:Math.max(13,size*0.34), height:Math.max(13,size*0.34), borderRadius:"50%", background:"linear-gradient(135deg,#1D6FEB,#56B0FF)", border:"2px solid #07060A", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <svg width="7" height="7" viewBox="0 0 24 24" fill="#FFFFFF"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
        </div>
      )}
    </div>
  );
}

// Rank card wrapper — handles all 5 tier borders + founder
function RankCard({ tier=0, children, c, founder=false, hasTopBanner=false }) {
  const rs = getRankBorderStyle(tier);

  const FounderRibbon = () => (
    <div style={{ position:"absolute", top:14, right:-28, background:"linear-gradient(135deg,#1D6FEB,#56B0FF)", color:"#FFFFFF", fontSize:7, fontWeight:900, padding:"3px 32px", transform:"rotate(45deg)", letterSpacing:"0.1em", zIndex:10, fontFamily:"'DM Sans',sans-serif" }}>FOUNDER</div>
  );

  if (founder) {
    return (
      <div style={{ padding:2, background:"linear-gradient(135deg,#1D6FEB,#56B0FF)", borderRadius:20, boxShadow:"0 0 20px #1D6FEB44" }}>
        <div style={{ background:c.card, borderRadius:18, overflow:"hidden", position:"relative" }}>
          <FounderRibbon/>
          {children}
        </div>
      </div>
    );
  }
  if (tier <= 2) {
    return (
      <div style={{ border:rs.border, borderRadius:18, overflow:"hidden", position:"relative", boxShadow:rs.shadow, background:c.card }}>
        {children}
      </div>
    );
  }
  if (tier === 3) {
    return (
      <div style={{ padding:2, background:rs.grad, borderRadius:20, boxShadow:rs.shadow }}>
        <div style={{ background:c.card, borderRadius:18, overflow:"hidden", position:"relative" }}>
          {children}
        </div>
      </div>
    );
  }
  // tier 4 — animated + ribbon
  return (
    <div style={{ padding:2, background:"linear-gradient(135deg,#8B0038,#C9892A,#FFD700,#8B0038)", borderRadius:20, boxShadow:rs.shadow }}>
      <div style={{ background:c.card, borderRadius:18, overflow:"hidden", position:"relative" }}>
        {!hasTopBanner && <div style={{ position:"absolute", top:38, right:-26, background:"linear-gradient(135deg,#C9892A,#FFD700)", color:"#000", fontSize:7, fontWeight:900, padding:"3px 30px", transform:"rotate(45deg)", letterSpacing:"0.1em", zIndex:5, fontFamily:"'DM Sans',sans-serif" }}>ELITE</div>}
        {children}
      </div>
    </div>
  );
}

// Category icon
function CatIcon({ cat, color, size=20 }) {
  const icons = {
    food:        <><path d="M4 14a8 8 0 0116 0z" fill={color}/><rect x="2" y="14" width="20" height="3" rx="1" fill={color}/><circle cx="12" cy="6" r="1.5" fill={color}/><rect x="11" y="6.5" width="2" height="3" fill={color}/></>,
    groceries:   <><path d="M5 7h14l-1.4 13H6.4z" fill={color}/><path d="M9 7V5a3 3 0 016 0v2h-2V5a1 1 0 00-2 0v2H9z" fill={color}/></>,
    stores:      <><path d="M3 9l2-5h14l2 5v3H3z" fill={color}/><path d="M3 12v9h6v-6h6v6h6v-9z" fill={color}/></>,
    electronics: <polygon points="13 2 4 14 11 14 10 22 20 10 13 10" fill={color}/>,
    flowers:     <><path d="M12 12c-3 0-5-2-5-5 0-2 1-4 2-5 1 2 2 3 3 5 1-2 2-3 3-5 1 1 2 3 2 5 0 3-2 5-5 5z" fill={color}/><path d="M11 12h2v9h-2z" fill={color}/><path d="M13 16c2 0 4-1 5-3-3 0-5 1-5 3z" fill={color}/><path d="M11 18c-2 0-4-1-5-3 3 0 5 1 5 3z" fill={color}/></>,
    pharmacies:  <><rect x="4" y="4" width="16" height="16" rx="3" fill={color}/><rect x="11" y="7" width="2" height="10" fill="#FFFFFF" fillOpacity="0.9"/><rect x="7" y="11" width="10" height="2" fill="#FFFFFF" fillOpacity="0.9"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none">{icons[cat]||null}</svg>;
}

// SVG icons
const Ico = {
  Back:   ({s=18,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>,
  Home:   ({s=20,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg>,
  Plus:   ({s=20,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Person: ({s=20,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Search: ({s=16,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Up:     ({s=16,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>,
  Down:   ({s=16,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>,
  Book:   ({s=16,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>,
  Share:  ({s=16,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  Pin:    ({s=14,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  Sun:    ({s=15,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  Moon:   ({s=15,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
  Check:  ({s=18,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Trash:  ({s=15,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
};

// Shared button
function Btn({ onClick, children, theme, outline=false, small=false, style={} }) {
  const c = TH[theme];
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={(e)=>{ sfx.tap(); onClick && onClick(e); }}
      onPointerDown={()=>setPressed(true)}
      onPointerUp={()=>setPressed(false)}
      onPointerLeave={()=>setPressed(false)}
      style={{
        width:"100%",
        padding:small?"10px 0":"15px 0",
        background:outline?"transparent":c.btnBg,
        color:outline?c.text:c.btnText,
        border:outline?`1.5px solid ${c.border}`:"none",
        borderRadius:14,
        fontSize:small?13:14,
        fontWeight:700,
        fontFamily:"'DM Sans',sans-serif",
        cursor:"pointer",
        letterSpacing:"0.01em",
        transform: pressed ? "scale(0.97)" : "scale(1)",
        boxShadow: outline ? "none" : (pressed ? "0 1px 4px rgba(0,0,0,0.08)" : "0 4px 14px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08)"),
        transition: "transform 0.12s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.18s ease, background 0.18s ease",
        WebkitTapHighlightColor: "transparent",
        ...style
      }}
      onMouseOver={e=>{ if(!outline){ e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.18), 0 2px 4px rgba(0,0,0,0.08)"; } }}
      onMouseOut={e=>{ if(!outline){ e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08)"; } }}
    >{children}</button>
  );
}

// Shared input style builder
const inp = (c) => ({ width:"100%", padding:"15px 16px", background:c.inputBg, color:c.text, border:`1.5px solid ${c.inputBorder}`, borderRadius:14, fontSize:14, fontFamily:"'DM Sans',sans-serif", outline:"none", transition:"border-color 0.2s" });

// ─────────────────────────────────────────────────────────────────────────────
// OPENING
// ─────────────────────────────────────────────────────────────────────────────
function Opening({ onStart, onLogin, onMerchant, onDev, themeMode, setThemeMode, theme, lang, setLang }) {
  const [on, setOn]                     = useState(false);
  const [showDevInput, setShowDevInput] = useState(false);
  const [devCode, setDevCode]           = useState("");
  const [devError, setDevError]         = useState(false);
  const DEV_CODE = "1234";
  const c = TH[theme];
  useEffect(()=>{setTimeout(()=>setOn(true),80);},[]);
  const a = d => on ? { animation:`fu .55s cubic-bezier(.34,1.4,.64,1) ${d}s both` } : { opacity:0 };

  const handleDevSubmit = () => {
    if (devCode.trim() === DEV_CODE) {
      SESSION.isAdmin = true;
      onDev();
    } else {
      setDevError(true);
      setDevCode("");
      setTimeout(()=>setDevError(false), 1200);
    }
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"space-between", padding:"64px 28px 40px" }}>
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14 }}>
        <div style={{ ...a(0.06) }}>
          <TagMark size={80} fill={c.text} holeBg={c.bg}/>
        </div>
        <div style={{ ...a(0.12), display:"flex", alignItems:"baseline", gap:8 }}>
          <span style={{ fontSize:46, fontWeight:800, color:c.text, letterSpacing:"-0.04em", fontFamily:"'DM Sans',sans-serif" }}>BKM</span>
          <span style={{ fontSize:22, color:c.accent, fontFamily:"'Noto Naskh Arabic',serif" }}>بكم</span>
        </div>
        <div style={{ ...a(0.16), fontSize:13, color:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.05em", textAlign:"center", maxWidth:260, lineHeight:1.5 }}>
          {lang==="ar"?"نحن نقوم بذلك حتى لا تضطر أنت":"We do it so you don't have to."}
        </div>
      </div>

      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ ...a(0.22), display:"flex", borderRadius:14, overflow:"hidden", border:`1px solid ${c.border}` }}>
          {[{k:"en",label:"English",ff:"'DM Sans',sans-serif"},{k:"ar",label:"العربية",ff:"'Noto Naskh Arabic',serif"}].map((l,i)=>(
            <button key={l.k} onClick={()=>setLang(l.k)} style={{ flex:1, padding:"15px 0", background:lang===l.k?c.btnBg:c.inputBg, color:lang===l.k?c.btnText:c.sub, border:"none", borderRight:i===0?`1px solid ${c.border}`:"none", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:l.ff, transition:"all 0.2s" }}>{l.label}</button>
          ))}
        </div>
        <div style={{ ...a(0.26), display:"flex", borderRadius:14, overflow:"hidden", border:`1px solid ${c.border}` }}>
          {[
            {k:"dark",  el:<Ico.Moon s={15} c={themeMode==="dark" ?TH[theme].btnText:TH[theme].sub}/>},
            {k:"auto",  el:<span style={{ fontSize:11, fontWeight:700, color:themeMode==="auto"?TH[theme].btnText:TH[theme].sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.06em" }}>AUTO</span>},
            {k:"light", el:<Ico.Sun  s={15} c={themeMode==="light"?TH[theme].btnText:TH[theme].sub}/>},
          ].map((t,i)=>(
            <button key={t.k} onClick={()=>setThemeMode(t.k)} style={{ flex:1, padding:"15px 0", background:themeMode===t.k?c.btnBg:c.inputBg, border:"none", borderRight:i<2?`1px solid ${c.border}`:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s" }}>{t.el}</button>
          ))}
        </div>

        <div style={a(0.30)}><Btn onClick={onStart} theme={theme}>{lang==="ar"?"ابدأ الآن":"Get Started"}</Btn></div>

        {/* Merchant sign-in */}
        <div style={{ ...a(0.32) }}>
          <button
            onClick={()=>{ sfx.tap(); onMerchant(); }}
            onPointerDown={e=>{ e.currentTarget.style.transform="scale(0.97)"; e.currentTarget.style.background=c.muted; }}
            onPointerUp={e=>{ e.currentTarget.style.transform="scale(1)"; e.currentTarget.style.background="transparent"; }}
            onPointerLeave={e=>{ e.currentTarget.style.transform="scale(1)"; e.currentTarget.style.background="transparent"; }}
            style={{ width:"100%", padding:"13px 0", background:"transparent", border:`1.5px solid ${c.border}`, borderRadius:14, fontSize:13, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, transition:"transform 0.12s cubic-bezier(0.34,1.56,0.64,1), background 0.18s ease", WebkitTapHighlightColor:"transparent" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h18v10a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path d="M3 9l2-5h14l2 5"/><line x1="12" y1="14" x2="12" y2="17"/></svg>
            {lang==="ar"?"دخول التاجر":"Merchant Sign In"}
          </button>
        </div>

        <div style={{ ...a(0.34), textAlign:"center" }}>
          <button onClick={onLogin} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>
            {lang==="ar"?"لديك حساب؟ ":"Already have an account? "}<span style={{ color:c.accent, fontWeight:700 }}>{lang==="ar"?"تسجيل الدخول":"Sign in"}</span>
          </button>
        </div>

        <div style={{ ...a(0.38), textAlign:"center", position:"relative" }}>
          {!showDevInput ? (
            <button onClick={()=>setShowDevInput(true)} style={{ background:"none", border:`1px dashed ${c.border}`, borderRadius:10, padding:"8px 20px", cursor:"pointer", fontSize:11, fontWeight:600, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>
              DEV
            </button>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10, animation:"fu 0.25s ease both", position:"relative" }}>
              <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.12em", textTransform:"uppercase", fontFamily:"'DM Sans',sans-serif" }}>Enter 4-digit code</div>
              <label style={{ display:"flex", gap:8, justifyContent:"center", animation:devError?"shakeX 0.4s ease both":"none", cursor:"text" }}>
                {[0,1,2,3].map(i=>(
                  <div key={i} style={{ width:48, height:56, borderRadius:12, border:`1.5px solid ${devError?c.accent:devCode.length===i?c.accent:c.inputBorder}`, background:c.inputBg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", transition:"border-color 0.15s" }}>
                    {devCode[i] ? "•" : ""}
                  </div>
                ))}
                <input
                  autoFocus
                  value={devCode}
                  onChange={e=>{
                    const v = e.target.value.replace(/\D/g,"").slice(0,4);
                    setDevCode(v);
                    if (v.length===4) setTimeout(()=>{
                      if (v === DEV_CODE) { SESSION.isAdmin = true; onDev(); }
                      else { setDevError(true); setDevCode(""); setTimeout(()=>setDevError(false), 1200); }
                    }, 150);
                  }}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  type="tel"
                  maxLength={4}
                  style={{ position:"absolute", opacity:0, top:0, left:0, width:"100%", height:"100%", border:"none", fontSize:16 }}
                />
              </label>
              <button onClick={()=>{setShowDevInput(false);setDevCode("");setDevError(false);}} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:4, padding:"6px", position:"relative", zIndex:2 }}>Cancel</button>
            </div>
          )}
          {devError && <div style={{ fontSize:11, color:c.accent, fontFamily:"'DM Sans',sans-serif", marginTop:6 }}>Wrong code</div>}
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING — Full-screen Top 10 interest ranking poll
// ─────────────────────────────────────────────────────────────────────────────
const ALL_INTERESTS = [
  "Food & Dining","Groceries","Electronics","Fashion & Clothing",
  "Pharmacies","Coffee & Cafes","Flowers & Gifts","Gaming",
  "Sports & Fitness","Beauty & Wellness","Home & Living","Books",
  "Automotive","Pet Supplies","Kids & Baby","Jewelry","Entertainment","Travel",
];

function Onboarding({ theme, onComplete }) {
  const [ranked, setRanked]         = useState([]);
  const [tappedChip, setTappedChip] = useState(null);
  const [dragIdx, setDragIdx]       = useState(null);
  const [dragOffset, setDragOffset] = useState(0); // Y offset from drag start
  const [hoverIdx, setHoverIdx]     = useState(null);
  const dragStartY                  = useRef(0);
  const rowRefs                     = useRef([]);
  const containerRef                = useRef(null);
  const c = TH[theme];

  const isSelected = (x) => ranked.includes(x);
  const canAdd     = ranked.length < 10;

  const addItem = (interest) => {
    if (!canAdd || isSelected(interest)) return;
    setTappedChip(interest);
    setTimeout(() => setTappedChip(null), 280);
    setTimeout(() => setRanked(r => [...r, interest]), 100);
  };

  const removeItem = (i) => setRanked(r => r.filter((_,idx) => idx !== i));
  const moveUp     = (i) => { if (i===0) return; setRanked(r=>{const n=[...r];[n[i-1],n[i]]=[n[i],n[i-1]];return n;}); };
  const moveDown   = (i) => { if (i===ranked.length-1) return; setRanked(r=>{const n=[...r];[n[i],n[i+1]]=[n[i+1],n[i]];return n;}); };

  const dragRectsRef = useRef([]); // captured at drag start, immune to live shifts

  const onPointerDown = (e, i) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartY.current = e.clientY;
    // Capture all row positions ONCE at drag start
    dragRectsRef.current = rowRefs.current.map(ref => {
      if (!ref) return null;
      const r = ref.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, mid: r.top + r.height / 2 };
    });
    setDragIdx(i);
    setHoverIdx(i);
    setDragOffset(0);
  };

  const onPointerMove = (e) => {
    if (dragIdx === null) return;
    const offset = e.clientY - dragStartY.current;
    setDragOffset(offset);

    // Use captured rects, not live ones
    const rects = dragRectsRef.current;
    const y = e.clientY;
    let over = dragIdx;

    // Walk through every row and find the slot whose midpoint zone we're in
    for (let idx = 0; idx < rects.length; idx++) {
      const rect = rects[idx];
      if (!rect) continue;
      if (idx === dragIdx) continue;
      // For rows ABOVE the dragged item, we drop above them when our pointer crosses their midpoint going up
      // For rows BELOW the dragged item, we drop below them when our pointer crosses their midpoint going down
      if (idx < dragIdx && y < rect.mid) {
        over = idx;
        break; // First (topmost) row whose mid we're above — drop here
      }
      if (idx > dragIdx) {
        if (y > rect.mid) over = idx; // Keep going - last matching row below
      }
    }
    setHoverIdx(over);
  };

  const onPointerUp = () => {
    if (dragIdx !== null && hoverIdx !== null && dragIdx !== hoverIdx) {
      setRanked(r => {
        const n = [...r];
        const item = n.splice(dragIdx, 1)[0];
        n.splice(hoverIdx, 0, item);
        return n;
      });
    }
    setDragIdx(null);
    setHoverIdx(null);
    setDragOffset(0);
  };

  const ready = ranked.length >= 3;

  return (
    <div
      ref={containerRef}
      style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", background:c.bg, position:"relative" }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >

      {/* Header */}
      <div style={{ padding:"16px 20px 12px", flexShrink:0, borderBottom:`1px solid ${c.border}` }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
          <span style={{ fontSize:20, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>Your Top 10</span>
          <button onClick={()=>onComplete([])} style={{ background:"none", border:`1px solid ${c.border}`, borderRadius:10, padding:"6px 14px", cursor:"pointer", fontSize:13, fontWeight:600, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>Skip</button>
        </div>
        <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginBottom:10 }}>
          Pick what you care about · {ranked.length}/10 selected
        </div>
        <div style={{ display:"flex", gap:3 }}>
          {Array.from({length:10}).map((_,i)=>(
            <div key={i} style={{ flex:1, height:4, borderRadius:2, background:i<ranked.length?c.accent:c.border, transition:"background 0.25s" }}/>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", overscrollBehavior:"contain" }}>

        {/* Ranked list */}
        {ranked.length > 0 && (
          <div style={{ padding:"14px 16px 6px" }}>
            <div style={{ fontSize:10, fontWeight:700, color:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:8 }}>
              Your Ranking · Drag the handle to reorder
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:7, position:"relative" }}>
              {ranked.map((interest, i) => {
                const isDragging   = dragIdx === i;
                const isDropTarget = dragIdx !== null && hoverIdx === i && dragIdx !== i;
                // Shift other items to make room for drop indicator
                let shift = 0;
                if (dragIdx !== null && !isDragging) {
                  if (dragIdx < i && hoverIdx >= i) shift = -56;
                  else if (dragIdx > i && hoverIdx <= i) shift = 56;
                }
                return (
                  <div
                    key={interest}
                    ref={el => rowRefs.current[i] = el}
                    style={{
                      display:"flex", alignItems:"center", gap:10,
                      background: i===0 ? `${c.accent}12` : c.surface,
                      border:`1.5px solid ${isDropTarget ? c.accent : i===0 ? c.accent+"55" : c.border}`,
                      borderRadius:14, padding:"11px 12px",
                      visibility: isDragging ? "hidden" : "visible",
                      transform: `translateY(${shift}px)`,
                      transition: isDragging ? "none" : "transform 0.22s cubic-bezier(0.34,1.2,0.64,1), border-color 0.18s, background 0.18s",
                      animation: i === ranked.length - 1 && dragIdx === null ? "scaleIn 0.32s cubic-bezier(0.34,1.56,0.64,1) both" : "none",
                      userSelect:"none",
                      WebkitUserSelect:"none",
                      position: "relative",
                      zIndex: 1,
                    }}
                  >
                    {/* Drop indicator line */}
                    {isDropTarget && (
                      <div style={{ position:"absolute", left:-2, right:-2, top:-5, height:3, background:c.accent, borderRadius:2, boxShadow:`0 0 8px ${c.accent}` }}/>
                    )}

                    {/* Drag handle */}
                    <div
                      onPointerDown={e=>onPointerDown(e,i)}
                      style={{ display:"flex", flexDirection:"column", gap:3, padding:"6px 4px", cursor:"grab", touchAction:"none", flexShrink:0 }}
                    >
                      {[0,1,2].map(r=>(
                        <div key={r} style={{ display:"flex", gap:3 }}>
                          <div style={{ width:3, height:3, borderRadius:"50%", background:c.sub, opacity:0.55 }}/>
                          <div style={{ width:3, height:3, borderRadius:"50%", background:c.sub, opacity:0.55 }}/>
                        </div>
                      ))}
                    </div>

                    <div style={{ width:28, height:28, borderRadius:8, background:i===0?c.accent:`${c.accent}15`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <span style={{ fontSize:13, fontWeight:800, color:i===0?"#FFFFFF":c.accent, fontFamily:"'DM Sans',sans-serif" }}>{i+1}</span>
                    </div>

                    <span style={{ flex:1, fontSize:14, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{interest}</span>

                    <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                      <button onClick={()=>moveUp(i)} disabled={i===0} style={{ width:28, height:28, background:c.muted, border:"none", borderRadius:8, cursor:i===0?"default":"pointer", display:"flex", alignItems:"center", justifyContent:"center", opacity:i===0?0.2:0.8 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c.text} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                      </button>
                      <button onClick={()=>moveDown(i)} disabled={i===ranked.length-1} style={{ width:28, height:28, background:c.muted, border:"none", borderRadius:8, cursor:i===ranked.length-1?"default":"pointer", display:"flex", alignItems:"center", justifyContent:"center", opacity:i===ranked.length-1?0.2:0.8 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c.text} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      <button onClick={()=>removeItem(i)} style={{ width:28, height:28, background:"transparent", border:`1px solid ${c.border}`, borderRadius:8, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={c.sub} strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Available chips */}
        <div style={{ padding: ranked.length>0 ? "10px 16px 24px" : "16px 16px 24px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:12 }}>
            {ranked.length===10 ? "Remove one to add another" : "Tap to add"}
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:9 }}>
            {ALL_INTERESTS.filter(x=>!isSelected(x)).map(interest => {
              const isTapped = tappedChip === interest;
              return (
                <button
                  key={interest}
                  onClick={()=>addItem(interest)}
                  style={{
                    padding:"10px 18px",
                    background: isTapped ? c.accent : c.surface,
                    border:`1.5px solid ${isTapped ? c.accent : c.border}`,
                    borderRadius:22, fontSize:13, fontWeight:600,
                    color: isTapped ? "#FFFFFF" : canAdd ? c.text : c.sub,
                    fontFamily:"'DM Sans',sans-serif",
                    cursor: canAdd ? "pointer" : "not-allowed",
                    opacity: canAdd ? 1 : 0.4,
                    WebkitTapHighlightColor:"transparent",
                    touchAction:"manipulation",
                    transform: isTapped ? "scale(0.94)" : "scale(1)",
                    transition: "transform 0.18s cubic-bezier(0.34,1.56,0.64,1), background 0.18s, border-color 0.18s, color 0.18s",
                  }}
                >
                  {interest}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Floating ghost — the lifted card that follows pointer ── */}
      {dragIdx !== null && rowRefs.current[dragIdx] && (() => {
        const origRect = rowRefs.current[dragIdx].getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect() || { top:0, left:0 };
        return (
          <div style={{
            position:"absolute",
            top: origRect.top - containerRect.top + dragOffset,
            left: origRect.left - containerRect.left,
            width: origRect.width,
            display:"flex", alignItems:"center", gap:10,
            background: c.surface,
            border:`2px solid ${c.accent}`,
            borderRadius:14, padding:"11px 12px",
            boxShadow:`0 16px 40px rgba(0,0,0,0.35), 0 0 0 4px ${c.accent}22`,
            transform:"scale(1.04) rotate(-1deg)",
            zIndex: 100,
            pointerEvents:"none",
            userSelect:"none",
            transition: "none",
          }}>
            <div style={{ display:"flex", flexDirection:"column", gap:3, padding:"6px 4px", flexShrink:0 }}>
              {[0,1,2].map(r=>(
                <div key={r} style={{ display:"flex", gap:3 }}>
                  <div style={{ width:3, height:3, borderRadius:"50%", background:c.accent }}/>
                  <div style={{ width:3, height:3, borderRadius:"50%", background:c.accent }}/>
                </div>
              ))}
            </div>
            <div style={{ width:28, height:28, borderRadius:8, background:c.accent, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ fontSize:13, fontWeight:800, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif" }}>{(hoverIdx ?? dragIdx) + 1}</span>
            </div>
            <span style={{ flex:1, fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{ranked[dragIdx]}</span>
          </div>
        );
      })()}

      {/* Confirm */}
      <div style={{ padding:"12px 20px 20px", flexShrink:0, borderTop:`1px solid ${c.border}`, background:c.bg }}>
        <button
          onClick={()=>ready && onComplete(ranked)}
          style={{
            width:"100%", padding:"15px 0",
            background: ready ? c.accent : c.muted,
            color: ready ? "#FFFFFF" : c.sub,
            border:"none", borderRadius:14, fontSize:14, fontWeight:700,
            fontFamily:"'DM Sans',sans-serif",
            cursor: ready ? "pointer" : "default",
            transition:"all 0.2s",
            boxShadow: ready ? `0 4px 20px ${c.accent}44` : "none",
          }}
        >
          {ready ? `Set My Top ${ranked.length} →` : `Select at least 3 to continue (${ranked.length}/3)`}
        </button>
      </div>

    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// MERCHANT LOGIN
// ─────────────────────────────────────────────────────────────────────────────
function MerchantLogin({ theme, lang, onLogin, onBack, onApply }) {
  const [email, setEmail]   = useState("");
  const [password, setPass] = useState("");
  const [error, setError]   = useState("");
  const [on, setOn]         = useState(false);
  const c = TH[theme];
  useEffect(()=>{setTimeout(()=>setOn(true),60);},[]);
  const a = d => on?{animation:`fu .45s ease ${d}s both`}:{opacity:0};

  // Demo merchant credentials (in production: Firebase Auth)
  const handleSubmit = () => {
    if (email==="merchant@bkm.qa" && password==="merchant123") {
      SESSION.isMerchant = true;
      SESSION.merchantName = "Al Wakra Shawarma Palace";
      SESSION.merchantCategory = "food";
      onLogin();
    } else {
      setError("Invalid credentials. Demo: merchant@bkm.qa / merchant123");
      setTimeout(()=>setError(""), 4000);
    }
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", padding:"24px 24px 32px" }}>
      <div style={{ ...a(0.04), display:"flex", alignItems:"center", marginBottom:24 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
      </div>

      <div style={{ ...a(0.08), textAlign:"center", marginBottom:32 }}>
        <div style={{ width:60, height:60, borderRadius:18, background:`${c.accent}15`, border:`1.5px solid ${c.accent}44`, display:"inline-flex", alignItems:"center", justifyContent:"center", marginBottom:14 }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h18v10a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path d="M3 9l2-5h14l2 5"/><line x1="12" y1="14" x2="12" y2="17"/></svg>
        </div>
        <div style={{ fontSize:22, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:6 }}>Merchant Sign In</div>
        <div style={{ fontSize:13, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.5 }}>Manage your listings and reach Doha shoppers</div>
      </div>

      <div style={{ ...a(0.12), display:"flex", flexDirection:"column", gap:12, flex:1 }}>
        <div>
          <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6, fontFamily:"'DM Sans',sans-serif" }}>Email</div>
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="merchant@example.com" style={inp(c)}/>
        </div>
        <div>
          <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6, fontFamily:"'DM Sans',sans-serif" }}>Password</div>
          <input type="password" value={password} onChange={e=>setPass(e.target.value)} placeholder="••••••••" style={inp(c)}/>
        </div>
        {error && <div style={{ fontSize:11, color:c.accent, fontFamily:"'DM Sans',sans-serif", padding:"8px 12px", background:`${c.accent}10`, borderRadius:10 }}>{error}</div>}

        <Btn onClick={handleSubmit} theme={theme}>Sign In to Merchant Portal</Btn>

        <div style={{ textAlign:"center", padding:"20px 0 0", marginTop:"auto" }}>
          <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginBottom:10 }}>Not a merchant yet?</div>
          <button type="button" onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); onApply && onApply(); }} style={{ background:"transparent", border:`1.5px solid ${c.border}`, borderRadius:12, padding:"11px 22px", fontSize:13, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", WebkitTapHighlightColor:"transparent" }}>
            Apply to be a Partner
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTNER REQUEST FORM
// ─────────────────────────────────────────────────────────────────────────────
function PartnerRequest({ theme, lang, onBack, onSubmitted }) {
  const [businessName, setBusinessName] = useState("");
  const [crNumber, setCrNumber]         = useState("");
  const [category, setCategory]         = useState("");
  const [contactName, setContactName]   = useState("");
  const [phone, setPhone]               = useState("");
  const [email, setEmail]               = useState("");
  const [district, setDistrict]         = useState("");
  const [message, setMessage]           = useState("");
  const [submitted, setSubmitted]       = useState(false);
  const [on, setOn]                     = useState(false);
  const c = TH[theme];
  useEffect(()=>{setTimeout(()=>setOn(true),60);},[]);
  const a = d => on?{animation:`fu .45s ease ${d}s both`}:{opacity:0};

  const crValid    = crNumber.length >= 4 && crNumber.length <= 8;
  const ready = businessName && crValid && category && contactName && phone && email && district;

  const handleSubmit = async () => {
    if (!ready) return;
    try {
      await fbSubmitPartnerRequest({ businessName, crNumber, category, contactName, phone, email, district, message });
    } catch (e) {
      // Fallback: still mark as submitted even if Firestore write fails (don't block user)
    }
    PARTNER_REQUESTS.push({
      id: Date.now(),
      businessName, crNumber, category, contactName, phone, email, district, message,
      submittedAt: new Date().toISOString(),
      status: "pending",
    });
    setSubmitted(true);
    setTimeout(()=>{ onSubmitted && onSubmitted(); }, 2400);
  };

  if (submitted) {
    return (
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20, padding:"0 28px" }}>
        <div style={{ width:72, height:72, borderRadius:"50%", background:"#16A34A15", border:"2px solid #16A34A55", display:"flex", alignItems:"center", justifyContent:"center", animation:"scaleIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both" }}>
          <Ico.Check s={32} c="#16A34A"/>
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:20, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:8 }}>Request Received</div>
          <div style={{ fontSize:13, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6 }}>The BKM team will review your application and get back to you within 48 hours via email.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ flex:1, overflowY:"auto", padding:"20px 24px 32px" }}>
        <div style={{ ...a(0.04), display:"flex", alignItems:"center", gap:12, marginBottom:18 }}>
          <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
          <div style={{ fontSize:18, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>Become a BKM Partner</div>
        </div>

        <div style={{ ...a(0.08), background:`${c.accent}08`, border:`1px solid ${c.accent}33`, borderRadius:14, padding:"14px", marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:700, color:c.accent, fontFamily:"'DM Sans',sans-serif", marginBottom:6 }}>List your business on BKM</div>
          <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6 }}>
            Free during beta. Manage your prices, reach thousands of Doha shoppers, build a verified following.
          </div>
        </div>

        <div style={{ ...a(0.12), display:"flex", flexDirection:"column", gap:14 }}>
          <div>
            <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6, fontFamily:"'DM Sans',sans-serif" }}>Business Name *</div>
            <input value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Your business name" style={inp(c)}/>
          </div>
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.08em", textTransform:"uppercase", fontFamily:"'DM Sans',sans-serif" }}>Commercial Registration (CR) Number *</div>
            </div>
            <input
              value={crNumber}
              onChange={e=>setCrNumber(e.target.value.replace(/\D/g,"").slice(0,8))}
              placeholder="e.g. 123456"
              inputMode="numeric"
              pattern="[0-9]*"
              type="tel"
              style={{ ...inp(c), borderColor: crNumber && !crValid ? c.accent : c.inputBorder }}
            />
            <div style={{ fontSize:10, color: crNumber && !crValid ? c.accent : c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:5, lineHeight:1.4 }}>
              {crNumber && !crValid ? "CR number must be 4-8 digits" : "Your Qatar Commercial Registration number issued by MoCI"}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6, fontFamily:"'DM Sans',sans-serif" }}>Category *</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {CATS.filter(x=>x.key!=="all").map(cat=>(
                <button key={cat.key} onClick={()=>setCategory(cat.key)} style={{ padding:"8px 14px", background:category===cat.key?c.accent:"transparent", border:`1.5px solid ${category===cat.key?c.accent:c.border}`, borderRadius:18, fontSize:12, fontWeight:600, color:category===cat.key?"#FFFFFF":c.text, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>{cat.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6, fontFamily:"'DM Sans',sans-serif" }}>Contact Person *</div>
            <input value={contactName} onChange={e=>setContactName(e.target.value)} placeholder="Full name" style={inp(c)}/>
          </div>
          <div>
            <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6, fontFamily:"'DM Sans',sans-serif" }}>Phone *</div>
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+974 XXXX XXXX" style={inp(c)}/>
          </div>
          <div>
            <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6, fontFamily:"'DM Sans',sans-serif" }}>Email *</div>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="business@example.com" style={inp(c)}/>
          </div>
          <div>
            <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6, fontFamily:"'DM Sans',sans-serif" }}>District *</div>
            <select value={district} onChange={e=>setDistrict(e.target.value)} style={{ ...inp(c), appearance:"none", paddingRight:32 }}>
              <option value="">Select your district</option>
              {AREAS.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6, fontFamily:"'DM Sans',sans-serif" }}>Tell us about your business</div>
            <textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="What do you sell? How did you hear about BKM?" rows={4} style={{ ...inp(c), resize:"none", paddingTop:12 }}/>
          </div>
        </div>
      </div>

      <div style={{ padding:"16px 24px 24px", flexShrink:0, borderTop:`1px solid ${c.border}`, background:c.bg }}>
        <button onClick={handleSubmit} disabled={!ready} style={{ width:"100%", padding:"15px 0", background:ready?c.accent:c.muted, color:ready?"#FFFFFF":c.sub, border:"none", borderRadius:14, fontSize:14, fontWeight:700, fontFamily:"'DM Sans',sans-serif", cursor:ready?"pointer":"default", transition:"all 0.2s" }}>
          Submit Application
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MERCHANT PORTAL
// ─────────────────────────────────────────────────────────────────────────────
function MerchantPortal({ theme, lang, onSignOut }) {
  const [tab, setTab]     = useState("dashboard");
  const [listings, setListings] = useState(MERCHANT_LISTINGS.filter(x=>x.merchant===SESSION.merchantName));
  const [showAdd, setShowAdd]   = useState(false);
  const [newItem, setNewItem]   = useState({ name:"", price:"", description:"" });
  const c = TH[theme];

  const myFollowers = 124; // demo number
  const myViews     = 1842;
  const myRevenue   = "QAR 8,400";

  const handleAddListing = () => {
    if (!newItem.name || !newItem.price) return;
    const item = {
      id: Date.now(),
      merchant: SESSION.merchantName,
      category: SESSION.merchantCategory,
      name: newItem.name,
      price: parseFloat(newItem.price),
      description: newItem.description,
      addedAt: new Date().toISOString(),
    };
    MERCHANT_LISTINGS.push(item);
    setListings(l=>[item, ...l]);
    setNewItem({ name:"", price:"", description:"" });
    setShowAdd(false);
  };

  const handleDelete = (id) => {
    const idx = MERCHANT_LISTINGS.findIndex(x=>x.id===id);
    if (idx>=0) MERCHANT_LISTINGS.splice(idx,1);
    setListings(l=>l.filter(x=>x.id!==id));
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"16px 20px 14px", borderBottom:`1px solid ${c.border}`, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
            <span style={{ fontSize:18, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{SESSION.merchantName||"Merchant"}</span>
            <span style={{ fontSize:9, fontWeight:700, color:c.accent, background:`${c.accent}15`, border:`1px solid ${c.accent}44`, borderRadius:5, padding:"2px 6px", fontFamily:"'DM Sans',sans-serif", flexShrink:0 }}>MERCHANT</span>
          </div>
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>BKM Merchant Portal</div>
        </div>
        <button onClick={onSignOut} title="Sign out" style={{ width:38, height:38, background:"transparent", border:`1px solid ${c.border}`, borderRadius:11, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all 0.18s" }}
          onMouseOver={e=>{ e.currentTarget.style.borderColor="#EF444466"; e.currentTarget.style.background="#EF444410"; }}
          onMouseOut={e=>{ e.currentTarget.style.borderColor=c.border; e.currentTarget.style.background="transparent"; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:`1px solid ${c.border}`, flexShrink:0 }}>
        {[
          {k:"dashboard", label:"Dashboard"},
          {k:"listings",  label:"Listings"},
          {k:"followers", label:"Followers"},
        ].map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} style={{ flex:1, padding:"13px 0", background:"transparent", border:"none", borderBottom:tab===t.k?`2px solid ${c.accent}`:"2px solid transparent", fontSize:12, fontWeight:tab===t.k?700:500, color:tab===t.k?c.accent:c.sub, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", transition:"all 0.2s" }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"18px 20px 24px" }}>

        {/* Dashboard */}
        {tab==="dashboard" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
              {[
                { label:"Followers",     val: myFollowers, sub:"+12 this week" },
                { label:"Profile Views", val: myViews,     sub:"+340 this week" },
                { label:"Active Listings", val: listings.length, sub:"" },
                { label:"Est. Revenue",  val: myRevenue,   sub:"This month" },
              ].map((s,i)=>(
                <div key={i} style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:14, padding:"13px 14px" }}>
                  <div style={{ fontSize:10, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"'DM Sans',sans-serif", marginBottom:6 }}>{s.label}</div>
                  <div style={{ fontSize:20, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>{s.val}</div>
                  {s.sub && <div style={{ fontSize:10, color:"#16A34A", fontFamily:"'DM Sans',sans-serif", marginTop:3 }}>{s.sub}</div>}
                </div>
              ))}
            </div>

            <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:14, padding:"14px" }}>
              <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:10 }}>Quick Actions</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <button onClick={()=>{ setTab("listings"); setShowAdd(true); }} style={{ padding:"11px 14px", background:c.accent, border:"none", borderRadius:11, fontSize:13, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", cursor:"pointer", textAlign:"left" }}>+ Add a New Listing</button>
                <button onClick={()=>setTab("followers")} style={{ padding:"11px 14px", background:"transparent", border:`1px solid ${c.border}`, borderRadius:11, fontSize:13, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", textAlign:"left" }}>View My Followers</button>
              </div>
            </div>
          </div>
        )}

        {/* Listings */}
        {tab==="listings" && (
          <div>
            {!showAdd ? (
              <button onClick={()=>setShowAdd(true)} style={{ width:"100%", padding:"13px 0", background:c.accent, border:"none", borderRadius:12, fontSize:13, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", cursor:"pointer", marginBottom:14 }}>
                + Add New Listing
              </button>
            ) : (
              <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:14, padding:"14px", marginBottom:14 }}>
                <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:10 }}>New Listing</div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  <input placeholder="Item name" value={newItem.name} onChange={e=>setNewItem(x=>({...x,name:e.target.value}))} style={inp(c)}/>
                  <input placeholder="Price (QAR)" type="number" value={newItem.price} onChange={e=>setNewItem(x=>({...x,price:e.target.value}))} style={inp(c)}/>
                  <textarea placeholder="Short description (optional)" rows={2} value={newItem.description} onChange={e=>setNewItem(x=>({...x,description:e.target.value}))} style={{ ...inp(c), resize:"none", paddingTop:10 }}/>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>{setShowAdd(false);setNewItem({name:"",price:"",description:""});}} style={{ flex:1, padding:"11px 0", background:"transparent", border:`1px solid ${c.border}`, borderRadius:10, fontSize:12, fontWeight:600, color:c.sub, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Cancel</button>
                    <button onClick={handleAddListing} disabled={!newItem.name || !newItem.price} style={{ flex:2, padding:"11px 0", background:newItem.name && newItem.price ? c.accent : c.muted, border:"none", borderRadius:10, fontSize:12, fontWeight:700, color:newItem.name && newItem.price ? "#FFFFFF" : c.sub, fontFamily:"'DM Sans',sans-serif", cursor:newItem.name && newItem.price ? "pointer" : "default" }}>Save Listing</button>
                  </div>
                </div>
              </div>
            )}

            {listings.length===0 ? (
              <div style={{ textAlign:"center", padding:"40px 24px" }}>
                <div style={{ fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:6 }}>No listings yet</div>
                <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>Add your first product to start reaching customers.</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
                {listings.map(item=>(
                  <div key={item.id} style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:13, padding:"12px 14px", display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{item.name}</div>
                      {item.description && <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:3 }}>{item.description}</div>}
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:14, fontWeight:800, color:c.accent, fontFamily:"'DM Sans',sans-serif" }}>QAR {item.price.toFixed(2)}</div>
                    </div>
                    <button onClick={()=>handleDelete(item.id)} style={{ width:30, height:30, background:"transparent", border:`1px solid ${c.border}`, borderRadius:8, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={c.sub} strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Followers */}
        {tab==="followers" && (
          <div>
            <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:14, padding:"16px 14px", textAlign:"center", marginBottom:14 }}>
              <div style={{ fontSize:32, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>{myFollowers}</div>
              <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>Total Followers</div>
            </div>
            <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10, fontFamily:"'DM Sans',sans-serif" }}>Recent followers</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {[
                { username:"DealHunterQ", time:"2h ago" },
                { username:"PearlFinds", time:"5h ago" },
                { username:"DohaDeals_", time:"1d ago" },
                { username:"LusailLooks", time:"2d ago" },
                { username:"NewHunter99", time:"3d ago" },
              ].map((f,i)=>(
                <div key={i} style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:12, padding:"10px 12px", display:"flex", alignItems:"center", gap:10 }}>
                  <ColorAvatar user={{username:f.username, av:f.username}} size={32}/>
                  <div style={{ flex:1, fontSize:13, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{f.username}</div>
                  <div style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>{f.time}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────────────────────────────────────
function Register({ theme, lang, onNext, onBack, onLogin }) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [on, setOn]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const c = TH[theme]; const ar = lang==="ar";
  useEffect(()=>{setTimeout(()=>setOn(true),60);},[]);
  const a = d => on?{animation:`fu .45s ease ${d}s both`}:{opacity:0};
  const is = inp(c);
  const ready = email && phone && phone.length >= 7 && !loading;

  const handleNext = async () => {
    if (!ready) return;
    setLoading(true);
    setError("");
    try {
      const result = await fbSignUpPhone(phone);
      sfx.success();
      onNext(phone, email);
    } catch (e) {
      setError(e.code === "auth/network-request-failed" ? "Network error. Check your connection." : "Couldn't create account. Try again.");
      sfx.error();
      setLoading(false);
    }
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"space-between", padding:"24px 28px 40px" }}>
      <div style={{ ...a(0.04), display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
        <span style={{ fontSize:22, fontWeight:700, color:c.text, letterSpacing:"-0.03em", fontFamily:"'DM Sans',sans-serif" }}>BKM</span>
        <span style={{ fontSize:11, color:c.accent, fontFamily:"'Noto Naskh Arabic',serif" }}>بكم</span>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <div style={a(0.1)}><input style={is} type="email" placeholder={ar?"البريد الإلكتروني":"Email address"} value={email} onChange={e=>setEmail(e.target.value)} onFocus={e=>e.target.style.borderColor=c.accent} onBlur={e=>e.target.style.borderColor=c.inputBorder}/></div>
        <div style={{ ...a(0.14), display:"flex", gap:10 }}>
          <div style={{ ...is, width:"auto", flexShrink:0, color:c.sub, display:"flex", alignItems:"center", whiteSpace:"nowrap" }}>+974</div>
          <input style={{ ...is }} type="tel" inputMode="numeric" placeholder={ar?"رقم الجوال":"Phone number"} value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,""))} onFocus={e=>e.target.style.borderColor=c.accent} onBlur={e=>e.target.style.borderColor=c.inputBorder}/>
        </div>
        {error && <div style={{ fontSize:12, color:c.accent, fontFamily:"'DM Sans',sans-serif" }}>{error}</div>}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <div style={a(0.18)}><Btn onClick={handleNext} theme={theme} style={{ opacity:ready?1:0.3 }}>{loading ? "..." : (ar?"متابعة":"Continue")}</Btn></div>
        <div style={{ ...a(0.22), textAlign:"center" }}>
          <button onClick={onLogin} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>
            {ar?"لديك حساب؟ ":"Already have an account? "}<span style={{ color:c.accent, fontWeight:700 }}>{ar?"دخول":"Sign in"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────────────────
function Login({ theme, lang, onNext, onBack, onRegister }) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [on, setOn]       = useState(false);
  const c = TH[theme]; const ar = lang==="ar";
  useEffect(()=>{setTimeout(()=>setOn(true),60);},[]);
  const a = d => on?{animation:`fu .45s ease ${d}s both`}:{opacity:0};
  const is = inp(c);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ready = email && phone && phone.length >= 7 && !loading;

  const handleNext = async () => {
    if (!ready) return;
    setLoading(true);
    setError("");
    try {
      await fbSignInPhone(phone);
      sfx.success();
      onNext(phone, email);
    } catch (e) {
      if (e.code === "auth/invalid-credential" || e.code === "auth/user-not-found" || e.code === "auth/wrong-password") {
        setError(ar?"لا يوجد حساب بهذا الرقم":"No account for this number. Tap Register below.");
      } else if (e.code === "auth/network-request-failed") {
        setError(ar?"خطأ في الاتصال":"Network error. Check your connection.");
      } else {
        setError(ar?"تعذر تسجيل الدخول":"Couldn't sign in. Try again.");
      }
      sfx.error();
      setLoading(false);
    }
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"space-between", padding:"24px 28px 40px" }}>
      <div style={{ ...a(0.04), display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
        <span style={{ fontSize:22, fontWeight:700, color:c.text, letterSpacing:"-0.03em", fontFamily:"'DM Sans',sans-serif" }}>BKM</span>
        <span style={{ fontSize:11, color:c.accent, fontFamily:"'Noto Naskh Arabic',serif" }}>بكم</span>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <div style={a(0.1)}><input style={is} type="email" placeholder={ar?"البريد الإلكتروني":"Email address"} value={email} onChange={e=>setEmail(e.target.value)} onFocus={e=>e.target.style.borderColor=c.accent} onBlur={e=>e.target.style.borderColor=c.inputBorder}/></div>
        <div style={{ ...a(0.14), display:"flex", gap:10 }}>
          <div style={{ ...is, width:"auto", flexShrink:0, color:c.sub, display:"flex", alignItems:"center", whiteSpace:"nowrap" }}>+974</div>
          <input style={{ ...is }} type="tel" inputMode="numeric" placeholder={ar?"رقم الجوال":"Phone number"} value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,""))} onFocus={e=>e.target.style.borderColor=c.accent} onBlur={e=>e.target.style.borderColor=c.inputBorder}/>
        </div>
        {error && <div style={{ fontSize:12, color:c.accent, fontFamily:"'DM Sans',sans-serif" }}>{error}</div>}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <div style={a(0.18)}><Btn onClick={handleNext} theme={theme} style={{ opacity:ready?1:0.3 }}>{loading ? "..." : (ar?"إرسال الرمز":"Send Code")}</Btn></div>
        <div style={{ ...a(0.22), textAlign:"center" }}>
          <button onClick={onRegister} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>
            {ar?"ليس لديك حساب؟ ":"No account? "}<span style={{ color:c.accent, fontWeight:700 }}>{ar?"إنشاء حساب":"Register"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OTP — 4 digits
// ─────────────────────────────────────────────────────────────────────────────
function OTP({ theme, lang, onVerify, onBack }) {
  const [code, setCode]   = useState(["","","",""]);
  const [on, setOn]       = useState(false);
  const [shake, setShake] = useState(false);
  const refs              = useRef([]);
  const c = TH[theme]; const ar = lang==="ar";
  useEffect(()=>{setTimeout(()=>setOn(true),60);},[]);
  const a = d => on?{animation:`fu .45s ease ${d}s both`}:{opacity:0};
  const filled = code.every(d=>d!=="");

  const onInput = (v,i) => {
    const d = v.replace(/\D/,"").slice(-1);
    const n = [...code]; n[i]=d; setCode(n);
    if (d && i<3) refs.current[i+1]?.focus();
  };
  const onKey = (e,i) => { if (e.key==="Backspace"&&!code[i]&&i>0) refs.current[i-1]?.focus(); };

  const handleVerify = () => {
    if (!filled) { setShake(true); setTimeout(()=>setShake(false),500); return; }
    SESSION.loggedIn = true;
    onVerify();
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"space-between", padding:"24px 28px 40px" }}>
      <div style={{ ...a(0.04), display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
        <span style={{ fontSize:22, fontWeight:700, color:c.text, letterSpacing:"-0.03em", fontFamily:"'DM Sans',sans-serif" }}>BKM</span>
        <span style={{ fontSize:11, color:c.accent, fontFamily:"'Noto Naskh Arabic',serif" }}>بكم</span>
      </div>

      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:18 }}>
        <div style={{ ...a(0.1), display:"flex", gap:14, animation: shake?"shakeX 0.4s ease both":undefined }}>
          {code.map((digit,i) => (
            <input key={i} ref={el=>refs.current[i]=el} type="tel" maxLength={1} value={digit}
              onChange={e=>onInput(e.target.value,i)} onKeyDown={e=>onKey(e,i)}
              style={{ width:62, height:70, background:c.inputBg, border:`2px solid ${digit?c.accent:c.inputBorder}`, borderRadius:16, textAlign:"center", fontSize:28, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", outline:"none", transition:"border-color 0.2s" }}
              onFocus={e=>e.target.style.borderColor=c.accent} onBlur={e=>e.target.style.borderColor=digit?c.accent:c.inputBorder}
            />
          ))}
        </div>
        <div style={a(0.14)}>
          <button style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", textDecoration:"underline" }}>
            {ar?"إعادة الإرسال":"Resend code"}
          </button>
        </div>
      </div>

      <div style={{ ...a(0.18), width:"100%" }}>
        <Btn onClick={handleVerify} theme={theme} style={{ opacity:filled?1:0.35 }}>{ar?"تحقق":"Verify"}</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEAL CARD
// ─────────────────────────────────────────────────────────────────────────────
const PLATFORM_META = {
  talabat: { color:"#FF6B35", label:"Talabat" },
  snoonu:  { color:"#7C3AED", label:"Snoonu"  },
  careem:  { color:"#16A34A", label:"Careem"  },
  rafeeq:  { color:"#0284C7", label:"Rafeeq"  },
  store:   { color:"#B8860B", label:"In Store" },
};

function DealCard({ deal, c, theme, claimed, onClaim, vote, onVote, bookmarked, onBookmark, onUserTap, onLocationTap, onOpenPost, limitReached, isOwn=false, onShareBonus, onPostBetter }) {
  const [priceAnim, setPriceAnim]   = useState(false);
  const [upAnim, setUpAnim]         = useState(false);
  const [downAnim, setDownAnim]     = useState(false);
  const [revealAnim, setRevealAnim] = useState(false);
  const [bmarkAnim, setBmarkAnim]   = useState(false);
  const [showShare, setShowShare]   = useState(false);
  const [claimCount, setClaimCount] = useState(deal.claims);
  useEffect(()=>{ setClaimCount(deal.claims); }, [deal.claims]);
  const rank      = deal.user.rank;
  const PM        = PLATFORM_META[deal.platform] || PLATFORM_META.store;
  const isFounder = deal.user.founder;
  const postBanner = getPostBanner(deal);
  const betaBadge  = getBetaBadge(deal.user.id);

  const handleClaim = () => {
    onClaim(deal.id);
    if (!limitReached) {
      setPriceAnim(true);
      setRevealAnim(true);
      setTimeout(() => setPriceAnim(false), 700);
      setTimeout(() => setRevealAnim(false), 500);
    }
  };

  const handleVote = (dir) => {
    if (dir === "up")   { setUpAnim(true);   setTimeout(()=>setUpAnim(false), 600); sfx.voteUp(); }
    if (dir === "down") { setDownAnim(true); setTimeout(()=>setDownAnim(false), 500); sfx.voteDown(); }
    onVote(deal.id, dir);
  };

  const handleBookmark = () => {
    setBmarkAnim(true);
    setTimeout(()=>setBmarkAnim(false), 600);
    sfx.bookmark();
    onBookmark(deal.id);
  };

  const upCount   = deal.ups;
  const downCount = deal.downs;

  return (
    <RankCard tier={rank} c={c} founder={isFounder} hasTopBanner={!!(postBanner || isOwn)}>
      <div style={{ padding:"13px 14px 12px" }}>

        {/* Post banner strip */}
        {(postBanner || isOwn) && (
          <div style={{ margin:"-13px -14px 11px -14px", background: postBanner ? postBanner.grad : "linear-gradient(90deg,#1D6FEB,#56B0FF)", padding:"7px 14px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:10, fontWeight:800, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.14em", textShadow:"0 1px 2px rgba(0,0,0,0.15)" }}>
              {isOwn ? `YOUR POST · ${claimCount} REVEALS` : postBanner?.label}
            </span>
            <div style={{ display:"flex", alignItems:"center", gap:3 }}>
              <div style={{ width:3, height:3, borderRadius:"50%", background:"rgba(255,255,255,0.5)" }}/>
              <div style={{ width:3, height:3, borderRadius:"50%", background:"rgba(255,255,255,0.5)" }}/>
              <div style={{ width:3, height:3, borderRadius:"50%", background:"rgba(255,255,255,0.5)" }}/>
            </div>
          </div>
        )}

        {/* ── User row ── */}
        <button onClick={()=>onUserTap(deal.user)} style={{ display:"flex", alignItems:"center", gap:9, background:"none", border:"none", cursor:"pointer", padding:0, width:"100%", textAlign:"left", marginBottom:10 }}>
          <Avatar user={deal.user} size={34}/>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              <span style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{deal.user.username}</span>
              <TierBadge user={deal.user} size="sm"/>
              {betaBadge && (
                <span style={{ fontSize:9, fontWeight:800, color:betaBadge.color, background:betaBadge.bg, border:`1px solid ${betaBadge.border}`, borderRadius:5, padding:"1px 6px", fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.06em" }}>β {betaBadge.label}</span>
              )}
              {deal.verified && <span style={{ fontSize:9, fontWeight:700, color:c.accent, background:`${c.accent}15`, border:`1px solid ${c.accent}30`, borderRadius:5, padding:"1px 5px", fontFamily:"'DM Sans',sans-serif" }}>VERIFIED</span>}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:3, flexWrap:"wrap" }}>
              <div style={{ display:"inline-flex", alignItems:"center", gap:3, background:`${PM.color}18`, border:`1px solid ${PM.color}44`, borderRadius:6, padding:"2px 7px" }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:PM.color }}/>
                <span style={{ fontSize:9, fontWeight:700, color:PM.color, fontFamily:"'DM Sans',sans-serif" }}>{PM.label}</span>
              </div>
              <span style={{ color:c.border, fontSize:10 }}>·</span>
              <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                <Ico.Pin s={9} c={c.accent}/>
                <span style={{ fontSize:10, color:c.accent, fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>{deal.district}</span>
              </div>
              <span style={{ color:c.border, fontSize:10 }}>·</span>
              <span style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>{deal.time} ago</span>
            </div>
          </div>
        </button>

        {/* Store name */}
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8, background:c.muted, borderRadius:9, padding:"6px 10px" }}>
          <Ico.Pin s={11} c={c.sub}/>
          <span style={{ fontSize:12, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{deal.place}</span>
          <span style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif", flexShrink:0 }}>{deal.address.split(",")[0]}</span>
        </div>

        {/* Subject */}
        <p style={{ fontSize:13, fontWeight:500, color:c.text, fontFamily:"'DM Sans',sans-serif", lineHeight:1.55, margin:"0 0 11px 0" }}>{deal.subject}</p>

        {/* Reveal / revealed */}
        {!claimed ? (
          <div style={{ marginBottom:11 }}>
            <button onClick={handleClaim} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:10, background:limitReached?c.muted:c.accent, border:limitReached?`1px dashed ${c.border}`:"none", borderRadius:12, padding:"14px 0", cursor:"pointer", boxShadow:limitReached?"none":`0 4px 20px ${c.accent}44`, transition:"transform 0.12s, box-shadow 0.12s", animation:revealAnim?"upBurst 0.4s ease both":"none" }}
              onMouseOver={e=>{ if(!limitReached){ e.currentTarget.style.transform="scale(1.02)"; e.currentTarget.style.boxShadow=`0 8px 28px ${c.accent}66`; } }}
              onMouseOut={e=>{ if(!limitReached){ e.currentTarget.style.transform="scale(1)"; e.currentTarget.style.boxShadow=`0 4px 20px ${c.accent}44`; } }}
            >
              {limitReached ? (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={c.sub}><polygon points="13 2 4 14 11 14 10 22 20 10 13 10"/></svg>
                  <span style={{ fontSize:13, fontWeight:700, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>Out of reveals · Tap to earn more</span>
                </>
              ) : (
                <>
                  <TagMark size={20} fill="#FFFFFF" holeBg={c.accent}/>
                  <div style={{ textAlign:"left" }}>
                    <div style={{ fontSize:16, fontWeight:900, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.08em" }}>BKM</div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.55)", fontFamily:"'DM Sans',sans-serif", marginTop:1 }}>{claimCount} people already revealed this</div>
                  </div>
                </>
              )}
            </button>
          </div>
        ) : (
          <button onClick={()=>onOpenPost(deal)} style={{ width:"100%", textAlign:"left", background:"none", border:"none", padding:0, cursor:"pointer", marginBottom:11 }}>
            <div style={{ background:c.muted, borderRadius:12, padding:"12px 14px", animation:priceAnim?"priceReveal 0.6s cubic-bezier(0.34,1.56,0.64,1) both":"none" }}>
              {deal.items.map((item,i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:i>0?8:0, marginTop:i>0?8:0, borderTop:i>0?`1px solid ${c.border}`:"none" }}>
                  <span style={{ fontSize:13, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{item.n}</span>
                  <span style={{ fontSize:16, fontWeight:800, color:c.accent, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>QAR {Number(item.p).toFixed(2)}</span>
                </div>
              ))}
              <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${c.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>Tap to see full post + map</span>
                <span style={{ fontSize:11, color:c.accent, fontWeight:700, fontFamily:"'DM Sans',sans-serif" }}>View →</span>
              </div>
            </div>
            {/* Inline map preview */}
            <div style={{ marginTop:7, borderRadius:12, overflow:"hidden", border:`1px solid ${c.border}`, position:"relative", height:80 }}>
              <svg width="100%" height="80" viewBox="0 0 335 80" preserveAspectRatio="xMidYMid slice">
                <rect width="335" height="80" fill={theme==="dark"?"#1A1810":"#E8E0CC"}/>
                {[0,1,2,3,4].map(i=><line key={`h${i}`} x1="0" y1={i*20} x2="335" y2={i*20} stroke={theme==="dark"?"#2A2010":"#D4C8A8"} strokeWidth="8"/>)}
                {[0,1,2,3,4,5,6,7,8,9].map(i=><line key={`v${i}`} x1={i*38} y1="0" x2={i*38} y2="80" stroke={theme==="dark"?"#2A2010":"#D4C8A8"} strokeWidth="8"/>)}
                {[[10,4,28,10],[50,4,48,10],[110,4,38,10],[160,4,50,10],[222,4,48,10],[10,22,58,10],[80,22,40,10],[132,22,50,10],[194,22,58,10],[10,44,30,10],[52,44,60,10],[124,44,68,10],[204,44,50,10],[266,44,62,10],[10,62,80,10],[102,62,50,10],[164,62,70,10],[246,62,80,10]].map(([x,y,w,h],i)=>(
                  <rect key={i} x={x} y={y} width={w} height={h} rx="2" fill={theme==="dark"?"#241C0C":"#C8BC98"} opacity="0.7"/>
                ))}
                <circle cx="167" cy="40" r="10" fill={c.accent} opacity="0.25"/>
                <circle cx="167" cy="40" r="6" fill={c.accent}/>
                <circle cx="167" cy="40" r="3" fill="#FFFFFF"/>
              </svg>
              <div style={{ position:"absolute", bottom:6, left:8, background:"rgba(0,0,0,0.65)", borderRadius:6, padding:"3px 8px" }}>
                <span style={{ fontSize:10, fontWeight:600, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif" }}>{deal.place}</span>
              </div>
              <div style={{ position:"absolute", top:6, right:8, background:c.accent, border:"none", borderRadius:6, padding:"3px 8px", cursor:"pointer" }}>
                <span style={{ fontSize:9, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif" }}>Open Maps</span>
              </div>
            </div>
          </button>
        )}

        {/* Post-reveal action strip — appears after a reveal */}
        {claimed && (
          <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:10, padding:"8px 10px", background:`${c.accent}08`, border:`1px dashed ${c.accent}33`, borderRadius:12, animation:"slideDown 0.35s cubic-bezier(0.34,1.2,0.64,1) both" }}>
            <span style={{ fontSize:10, fontWeight:700, color:c.accent, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap", marginRight:2 }}>Helpful?</span>
            <button onClick={()=>handleVote("up")} title="Yes, helpful" style={{ width:30, height:30, background:vote==="up"?c.accent:"transparent", border:`1.5px solid ${vote==="up"?c.accent:c.border}`, borderRadius:9, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={vote==="up"?"#FFFFFF":c.sub} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l4.41-7.41A2 2 0 0 1 13.07 2H14a2 2 0 0 1 2 2v1.88z"/></svg>
            </button>
            <button onClick={()=>handleVote("down")} title="Not helpful" style={{ width:30, height:30, background:vote==="down"?c.sub:"transparent", border:`1.5px solid ${vote==="down"?c.sub:c.border}`, borderRadius:9, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={vote==="down"?"#FFFFFF":c.sub} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2"/><path d="M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-4.41 7.41A2 2 0 0 1 10.93 22H10a2 2 0 0 1-2-2v-1.88z"/></svg>
            </button>
            <button onClick={()=>handleBookmark()} title={bookmarked?"Saved":"Save"} style={{ width:30, height:30, background:bookmarked?c.accent:"transparent", border:`1.5px solid ${bookmarked?c.accent:c.border}`, borderRadius:9, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill={bookmarked?"#FFFFFF":"none"} stroke={bookmarked?"#FFFFFF":c.sub} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button onClick={()=>onPostBetter && onPostBetter(deal)} style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5, background:c.accent, border:"none", borderRadius:9, padding:"7px 12px", cursor:"pointer" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              <span style={{ fontSize:11, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" }}>Better price?</span>
            </button>
          </div>
        )}

        {/* Action bar */}
        <div style={{ display:"flex", alignItems:"center", gap:7, position:"relative" }}>
          <button onClick={()=>handleVote("up")} style={{ display:"flex", alignItems:"center", gap:4, background:vote==="up"?`${c.accent}18`:"transparent", border:`1px solid ${vote==="up"?c.accent:c.border}`, borderRadius:20, padding:"6px 12px", cursor:"pointer", transition:"all 0.15s", animation:upAnim?"upBurst 0.55s cubic-bezier(0.34,1.56,0.64,1) both":"none" }}>
            <Ico.Up s={13} c={vote==="up"?c.accent:c.sub}/>
            <span style={{ fontSize:12, fontWeight:vote==="up"?700:400, color:vote==="up"?c.accent:c.sub, fontFamily:"'DM Sans',sans-serif", transition:"color 0.15s" }}>{upCount}</span>
          </button>
          <button onClick={()=>handleVote("down")} style={{ display:"flex", alignItems:"center", gap:4, background:"transparent", border:`1px solid ${c.border}`, borderRadius:20, padding:"6px 12px", cursor:"pointer", transition:"all 0.15s", animation:downAnim?"downSink 0.45s ease both":"none" }}>
            <Ico.Down s={13} c={vote==="down"?c.text:c.sub}/>
            <span style={{ fontSize:12, color:vote==="down"?c.text:c.sub, fontFamily:"'DM Sans',sans-serif" }}>{downCount}</span>
          </button>
          <div style={{ flex:1 }}/>
          {/* Bookmark */}
          <button onClick={handleBookmark} style={{ width:34, height:34, background:bookmarked?`${c.accent}15`:"transparent", border:`1px solid ${bookmarked?c.accent:c.border}`, borderRadius:"50%", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s", animation:bmarkAnim?"bookmarkPop 0.55s cubic-bezier(0.34,1.56,0.64,1) both":"none" }}>
            <Ico.Book s={14} c={bookmarked?c.accent:c.sub}/>
          </button>
          {/* Share */}
          <button onClick={()=>setShowShare(true)} style={{ width:34, height:34, background:"transparent", border:`1px solid ${c.border}`, borderRadius:"50%", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}
            onMouseOver={e=>e.currentTarget.style.borderColor=c.accent+"44"}
            onMouseOut={e=>e.currentTarget.style.borderColor=c.border}
          >
            <Ico.Share s={14} c={c.sub}/>
          </button>

          {/* Share sheet */}
          {showShare && (() => {
            const shareUrl  = "https://bkm-app.vercel.app";
            const shareText = `${deal.user.username} found a deal at ${deal.place} (${deal.district}) on BKM — ${deal.subject.slice(0,80)}${deal.subject.length>80?"...":""}\n\nBKM — Community-powered price discovery in Qatar. We do it so you don't have to.\n\n${shareUrl}`;
            const grantShareBonus = () => {
              sfx.whoosh();
              const earned = tryShareBonus();
              if (earned > 0 && onShareBonus) onShareBonus(earned);
            };
            const handleNative = async () => {
              setShowShare(false);
              if (navigator.share) {
                try { await navigator.share({ title:`BKM — ${deal.place}`, text:shareText, url:shareUrl }); grantShareBonus(); } catch(e){}
              } else {
                navigator.clipboard?.writeText(shareText); grantShareBonus();
              }
            };
            const handleWhatsApp = () => { setShowShare(false); window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`,"_blank"); grantShareBonus(); };
            const handleCopy     = () => { setShowShare(false); navigator.clipboard?.writeText(shareText); grantShareBonus(); };
            const handleX        = () => { setShowShare(false); window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,"_blank"); grantShareBonus(); };
            return (
              <>
                <div style={{ position:"fixed", inset:0, zIndex:200 }} onClick={()=>setShowShare(false)}/>
                <div style={{ position:"absolute", bottom:"calc(100% + 8px)", right:0, zIndex:201, background:c.surface, border:`1px solid ${c.border}`, borderRadius:16, padding:"10px 0", boxShadow:"0 -4px 24px rgba(0,0,0,0.18)", minWidth:200, animation:"shareSlide 0.2s ease both" }}>
                  <div style={{ fontSize:10, color:c.sub, letterSpacing:"0.12em", textTransform:"uppercase", padding:"0 14px 8px", fontFamily:"'DM Sans',sans-serif" }}>Share via</div>
                  {[
                    { label:"Share...",   action:handleNative },
                    { label:"WhatsApp",   action:handleWhatsApp },
                    { label:"Copy Link",  action:handleCopy },
                    { label:"X / Twitter",action:handleX },
                  ].map(opt=>(
                    <button key={opt.label} onClick={opt.action} style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 14px", background:"none", border:"none", cursor:"pointer", textAlign:"left", transition:"background 0.12s" }}
                      onMouseOver={e=>e.currentTarget.style.background=c.muted}
                      onMouseOut={e=>e.currentTarget.style.background="none"}
                    >
                      <span style={{ fontSize:13, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </>
            );
          })()}
        </div>

      </div>
    </RankCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FEED
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// FEED
// ─────────────────────────────────────────────────────────────────────────────
function Feed({ theme, lang, deals:initialDeals, onUserTap, onLocationTap, onSearch, onOpenPost, onReveal, onUpvote, onPartnerRequest, onPostBetter }) {
  const interests = SESSION.interests || [];
  const [deals, setDeals]           = useState(initialDeals||DEALS);
  const [claimed, setClaimed]       = useState(new Set(SESSION.claimed));
  const [votes, setVotes]           = useState({});
  const [bookmarked, setBookmarked] = useState(new Set());
  const [activeCat, setActiveCat]   = useState("all");
  const [locPerm, setLocPerm]       = useState(SESSION.locPerm);
  const [hasLoc, setHasLoc]         = useState(SESSION.hasLoc);
  const [locLoading, setLocLoading] = useState(false);
  const [energy, setEnergy]         = useState(calculateCurrentEnergy());
  const [showTutorial, setShowTutorial] = useState(!SESSION.tutorialSeen);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [feedFilter, setFeedFilter] = useState(SESSION.feedFilter||"foryou");
  const [pullDist, setPullDist]     = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [bonusToast, setBonusToast] = useState(null); // {amount, reason}
  const pullStartY                  = useRef(null);
  const scrollRef                   = useRef(null);
  const limitReached = energy <= 0;

  useEffect(()=>{ if(initialDeals) setDeals(initialDeals); },[initialDeals]);
  const [showAreas, setShowAreas] = useState(false);
  const [on, setOn]               = useState(false);
  const hint                      = useTyping(HINTS);
  const [query, setQuery]         = useState("");
  const c = TH[theme];

  useEffect(()=>{setTimeout(()=>setOn(true),80);},[]);

  // Grant daily login bonus once per session per day
  useEffect(() => {
    const granted = claimDailyBonus();
    if (granted > 0) {
      const newEnergy = calculateCurrentEnergy();
      setEnergy(newEnergy);
      setTimeout(() => { sfx.earn(); showBonus(granted, "Daily login bonus"); }, 1200);
    }
  }, []);

  // Periodic refill check (every minute)
  useEffect(() => {
    const interval = setInterval(() => setEnergy(calculateCurrentEnergy()), 60000);
    return () => clearInterval(interval);
  }, []);

  const showBonus = (amount, reason) => {
    setBonusToast({ amount, reason, id: Date.now() });
    setTimeout(() => setBonusToast(null), 2400);
  };

  // Pull-to-refresh logic
  const onTouchStartRefresh = (e) => {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      pullStartY.current = e.touches[0].clientY;
    }
  };
  const onTouchMoveRefresh = (e) => {
    if (pullStartY.current === null) return;
    const dist = e.touches[0].clientY - pullStartY.current;
    if (dist > 0) {
      const damped = Math.min(dist * 0.45, 80);
      setPullDist(damped);
      if (dist > 8) e.preventDefault();
    }
  };
  const onTouchEndRefresh = () => {
    if (pullDist > 60) {
      setRefreshing(true);
      setPullDist(60);
      setTimeout(() => {
        setRefreshing(false);
        setPullDist(0);
        // Re-shuffle deals slightly to feel "refreshed"
        setDeals(ds => [...ds].sort(()=>Math.random()-0.5));
      }, 900);
    } else {
      setPullDist(0);
    }
    pullStartY.current = null;
  };

  const handleClaim = (id) => {
    if (limitReached) { sfx.error(); setShowLimitModal(true); return; }
    if (!consumeReveal()) { sfx.error(); setShowLimitModal(true); return; }
    sfx.reveal();
    SESSION.claimed.add(id);
    setEnergy(SESSION.revealEnergy);
    setClaimed(s => { const n=new Set(s); n.add(id); return n; });
    setDeals(ds => ds.map(d => d.id===id ? { ...d, claims: d.claims+1 } : d));

    // Update streak (only counts once per day)
    const wasNewStreakDay = SESSION.lastRevealDate !== todayKey();
    updateStreakOnReveal();
    if (wasNewStreakDay && SESSION.streak >= 2) {
      setTimeout(() => { sfx.streak(); showBonus(0, `${SESSION.streak}-day streak`); }, 600);
    }

    // Notify the poster if it's their own post being revealed
    const deal = deals.find(d=>d.id===id);
    if (deal && deal.user.id === getMe().id && onReveal) onReveal(`Someone revealed your post about ${deal.place}`);
    if (SESSION.revealEnergy <= 0) setTimeout(()=>setShowLimitModal(true), 800);
  };

  const handleVote = (id, dir) => {
    const prev = votes[id] || null;
    setVotes(v => ({ ...v, [id]: prev===dir ? null : dir }));
    setDeals(ds => ds.map(d => {
      if (d.id !== id) return d;
      let ups=d.ups, downs=d.downs;
      if (prev==="up")   ups   = Math.max(0, ups-1);
      if (prev==="down") downs = Math.max(0, downs-1);
      if (dir!==prev) { if(dir==="up") ups++; if(dir==="down") downs++; }
      return { ...d, ups, downs };
    }));
    // Notify poster on upvote of their own post
    if (dir==="up" && prev!=="up") {
      const deal = deals.find(d=>d.id===id);
      if (deal && deal.user.id === getMe().id && onUpvote) onUpvote(`${getMe().username} upvoted your post about ${deal.place}`);
    }
  };

  // Filter by category, then by feed mode (For You / Following), then by interests
  const filtered = (() => {
    let base = activeCat==="all" ? deals : deals.filter(d=>d.cat===activeCat);
    // Following filter
    if (feedFilter === "following" && SESSION.following.size > 0) {
      base = base.filter(d => SESSION.following.has(d.user.id));
    }
    // Personalized For You ranking based on interests (only when no specific category)
    if (feedFilter === "foryou" && interests.length > 0 && activeCat==="all") {
      const catMap = { food:"Food & Dining", groceries:"Groceries", stores:"Fashion & Clothing", electronics:"Electronics", flowers:"Flowers & Gifts", pharmacies:"Pharmacies" };
      const prioritised = base.filter(d => interests.includes(catMap[d.cat]));
      const rest = base.filter(d => !interests.includes(catMap[d.cat]));
      base = [...prioritised, ...rest];
    }
    return base;
  })();
  const handleBmark  = (id) => setBookmarked(s => { const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  const handleAddItem = (dealId, item) => {
    setDeals(ds => ds.map(d => d.id===dealId ? { ...d, items:[...d.items,{n:item.n,p:parseFloat(item.p)}] } : d));
  };

  const handleAllow = () => {
    // Immediately dismiss the permission modal so loading overlay shows alone
    setLocPerm("granted");
    setLocLoading(true);
    setTimeout(() => {
      const loc = "The Pearl, Doha";
      setHasLoc(loc);
      setLocLoading(false);
      SESSION.locPerm = "granted";
      SESSION.hasLoc = loc;
    }, 900);
  };

  const handleDeny = () => {
    setLocPerm("denied");
    SESSION.locPerm = "denied";
  };

  const dismissTutorial = () => {
    SESSION.tutorialSeen = true;
    setShowTutorial(false);
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", position:"relative" }}>

      {/* ── Tutorial overlay — first time only ── */}
      {showTutorial && (
        <div style={{ position:"absolute", inset:0, zIndex:110, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(2px)" }} onClick={dismissTutorial}/>
          <div style={{ position:"relative", zIndex:1, background:theme==="dark"?"#1A1208":TH.light.surface, borderRadius:"26px 26px 0 0", padding:"28px 24px 40px", animation:"slideUp 0.35s cubic-bezier(0.34,1.2,0.64,1) both" }}>
            <div style={{ textAlign:"center", marginBottom:20 }}>
              <TagMark size={44} fill={TH[theme].accent} holeBg={theme==="dark"?"#1A1208":TH.light.surface}/>
            </div>
            <div style={{ fontSize:18, fontWeight:700, color:TH[theme].text, fontFamily:"'DM Sans',sans-serif", textAlign:"center", marginBottom:16 }}>How BKM works</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:24 }}>
              {[
                { n:"1", t:"Discover deals on the Feed",     d:"Scroll real posts from people in Doha. Read the take, see the location." },
                { n:"2", t:"Reveal the price",               d:"Tap REVEAL PRICE to unlock it. You get 10 reveals a day — make them count." },
                { n:"3", t:"Find the best price on Search",  d:"Search any item. See verified prices from real users across all platforms, ranked cheapest first." },
                { n:"4", t:"Post your own find",             d:"Spotted a deal? Post it. No prices in your take — just the context. The price lives behind the reveal." },
                { n:"5", t:"Build your reputation",         d:"Every verified post earns you rank. More rank means more reach. Your following grows with every find." },
              ].map(s => (
                <div key={s.n} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                  <div style={{ width:24, height:24, borderRadius:"50%", background:TH[theme].accent, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
                    <span style={{ fontSize:11, fontWeight:800, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif" }}>{s.n}</span>
                  </div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:TH[theme].text, fontFamily:"'DM Sans',sans-serif" }}>{s.t}</div>
                    <div style={{ fontSize:11, color:TH[theme].sub, fontFamily:"'DM Sans',sans-serif", marginTop:2, lineHeight:1.5 }}>{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={dismissTutorial} style={{ width:"100%", padding:"15px 0", background:TH[theme].accent, border:"none", borderRadius:14, fontSize:14, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>
              Got it — let's go
            </button>
          </div>
        </div>
      )}

      {/* Out of energy modal — show how to earn more */}
      {showLimitModal && (
        <div style={{ position:"absolute", inset:0, zIndex:120, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 28px" }}>
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.75)", backdropFilter:"blur(4px)" }} onClick={()=>setShowLimitModal(false)}/>
          <div style={{ position:"relative", zIndex:1, background:theme==="dark"?"#1A1208":TH.light.surface, borderRadius:24, padding:"28px 24px", textAlign:"center", animation:"scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both", width:"100%" }}>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:14, animation:"upBurst 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.1s both" }}>
              <div style={{ width:64, height:64, borderRadius:18, background:`${TH[theme].accent}15`, border:`1.5px solid ${TH[theme].accent}55`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill={TH[theme].accent}><polygon points="13 2 4 14 11 14 10 22 20 10 13 10"/></svg>
              </div>
            </div>
            <div style={{ fontSize:20, fontWeight:800, color:TH[theme].text, fontFamily:"'DM Sans',sans-serif", marginBottom:6, letterSpacing:"-0.02em" }}>
              Out of energy
            </div>
            <div style={{ fontSize:12, color:TH[theme].sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.5, marginBottom:18 }}>
              Refills 1 every 2 hours · next in <span style={{ fontWeight:700, color:TH[theme].text }}>{getTimeToNextRefill()||"soon"}</span><br/>Or earn more by being active:
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:18 }}>
              {[
                { icon:"plus",   action:"Post a deal",         reward:"+3" },
                { icon:"thumb",  action:"Get an upvote",       reward:"+1" },
                { icon:"share",  action:"Share a deal",        reward:"+1 (max 3/day)" },
                { icon:"sun",    action:"Daily login",         reward:"+5 (auto)" },
              ].map((row,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", background:TH[theme].muted, borderRadius:11, border:`1px solid ${TH[theme].border}` }}>
                  <span style={{ fontSize:12, fontWeight:600, color:TH[theme].text, fontFamily:"'DM Sans',sans-serif" }}>{row.action}</span>
                  <span style={{ fontSize:11, fontWeight:800, color:TH[theme].accent, fontFamily:"'DM Sans',sans-serif" }}>{row.reward}</span>
                </div>
              ))}
            </div>
            <button onClick={()=>setShowLimitModal(false)} style={{ width:"100%", padding:"13px 0", background:TH[theme].accent, border:"none", borderRadius:13, fontSize:14, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>
              Got it
            </button>
          </div>
        </div>
      )}
      {locPerm==="pending" && (
        <div style={{ position:"absolute", inset:0, zIndex:100, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(3px)" }} onClick={()=>setLocPerm("denied")}/>
          <div style={{ position:"relative", zIndex:1, background:theme==="dark"?"#1C1410":c.surface, borderRadius:"26px 26px 0 0", padding:"28px 24px 40px", animation:"slideUp 0.35s cubic-bezier(0.34,1.2,0.64,1) both" }}>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:18 }}>
              <div style={{ width:64, height:64, borderRadius:16, background:c.accent, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:`0 8px 24px ${c.accent}44` }}>
                <TagMark size={34} fill="#FFFFFF" holeBg={c.accent}/>
              </div>
            </div>
            <div style={{ textAlign:"center", marginBottom:10 }}>
              <div style={{ fontSize:17, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:8 }}>Allow <span style={{ color:c.accent }}>BKM</span> to use your location?</div>
              <div style={{ fontSize:13, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6 }}>BKM uses your location to show you deals and prices available near you in Doha.</div>
            </div>
            <div style={{ height:1, background:c.border, margin:"20px 0" }}/>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <button onClick={handleAllow} style={{ width:"100%", padding:"14px 0", background:c.accent, color:"#FFFFFF", border:"none", borderRadius:14, fontSize:15, fontWeight:700, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Allow While Using App</button>
              <button onClick={handleAllow} style={{ width:"100%", padding:"14px 0", background:theme==="dark"?"#2A1A10":"#F0E8DC", color:c.text, border:"none", borderRadius:14, fontSize:15, fontWeight:600, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Allow Once</button>
              <button onClick={handleDeny} style={{ width:"100%", padding:"14px 0", background:"transparent", color:c.sub, border:"none", borderRadius:14, fontSize:15, fontWeight:500, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Don't Allow</button>
            </div>
          </div>
        </div>
      )}

      {/* Location detecting overlay */}
      {locLoading && (
        <div style={{ position:"absolute", inset:0, zIndex:90, display:"flex", alignItems:"center", justifyContent:"center", background:theme==="dark"?"rgba(7,6,10,0.75)":"rgba(245,240,232,0.75)", backdropFilter:"blur(3px)" }}>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:14 }}>
            <div style={{ width:44, height:44, border:`3px solid ${c.muted}`, borderTop:`3px solid ${c.accent}`, borderRadius:"50%", animation:"bkmSpin 0.8s linear infinite" }}/>
            <span style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase" }}>Locating</span>
          </div>
        </div>
      )}

      {/* Area picker overlay */}
      {showAreas && (
        <div style={{ position:"absolute", inset:0, zIndex:50 }} onMouseDown={()=>setShowAreas(false)}/>
      )}
      {showAreas && (
        <div style={{ position:"absolute", top:50, left:20, zIndex:51, background:c.surface, border:`1px solid ${c.border}`, borderRadius:14, overflow:"hidden", boxShadow:"0 8px 24px rgba(0,0,0,0.18)", width:200, animation:"fu 0.15s ease both" }}>
          {AREAS.map(area=>(
            <button key={area} onMouseDown={e=>{e.stopPropagation();setHasLoc(area);setShowAreas(false);SESSION.hasLoc=area;SESSION.locPerm="granted";}} style={{ display:"block", width:"100%", padding:"11px 14px", background:hasLoc===area?c.pill:"transparent", border:"none", borderBottom:`1px solid ${c.border}`, fontSize:13, color:c.text, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", textAlign:"left", fontWeight:hasLoc===area?700:400 }}>{area}</button>
          ))}
        </div>
      )}

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        onTouchStart={onTouchStartRefresh}
        onTouchMove={onTouchMoveRefresh}
        onTouchEnd={onTouchEndRefresh}
        style={{ flex:1, overflowY:"auto", paddingBottom:12, position:"relative", overscrollBehavior:"contain" }}
      >

        {/* Pull-to-refresh indicator */}
        {(pullDist > 0 || refreshing) && (
          <div style={{ position:"absolute", top:0, left:0, right:0, height:pullDist, display:"flex", alignItems:"center", justifyContent:"center", zIndex:5, transition:refreshing?"none":"height 0.2s ease" }}>
            <div style={{ width:32, height:32, borderRadius:"50%", border:`2.5px solid ${c.border}`, borderTopColor:c.accent, animation:refreshing?"bkmSpin 0.8s linear infinite":"none", transform:`rotate(${pullDist*4}deg)`, opacity:Math.min(pullDist/60, 1) }}/>
          </div>
        )}
        <div style={{ paddingTop: pullDist, transition:refreshing?"none":"padding-top 0.2s ease" }}>

        {/* Location bar */}
        <div style={{ padding:"10px 20px 0", position:"relative" }}>
          {hasLoc ? (
            <button onClick={()=>setShowAreas(o=>!o)} style={{ display:"flex", alignItems:"center", gap:5, background:"none", border:"none", cursor:"pointer", padding:0 }}>
              <Ico.Pin s={13} c={c.accent}/><span style={{ fontSize:13, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{hasLoc}</span>
              <Ico.Down s={11} c={c.sub}/>
            </button>
          ) : locPerm==="denied" ? (
            <button onClick={()=>setShowAreas(true)} style={{ display:"flex", alignItems:"center", gap:7, background:`${c.accent}10`, border:`1px solid ${c.accent}35`, borderRadius:10, padding:"7px 12px", cursor:"pointer" }}>
              <Ico.Pin s={12} c={c.accent}/><span style={{ fontSize:12, fontWeight:600, color:c.accent, fontFamily:"'DM Sans',sans-serif" }}>Set location manually</span>
            </button>
          ) : <div style={{ height:22 }}/>}
        </div>

        {/* Header */}
        <div style={{ padding:"12px 20px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
              <span style={{ fontSize:26, fontWeight:700, color:c.text, letterSpacing:"-0.04em", fontFamily:"'DM Sans',sans-serif" }}>BKM</span>
              <span style={{ fontSize:12, color:c.accent, fontFamily:"'Noto Naskh Arabic',serif" }}>بكم</span>
            </div>
            <span style={{ fontSize:9, fontWeight:700, color:"#F59E0B", background:"#F59E0B18", border:"1px solid #F59E0B44", borderRadius:5, padding:"2px 6px", fontFamily:"'DM Sans',sans-serif" }}>BETA</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            {SESSION.streak > 0 && (
              <div style={{ display:"flex", alignItems:"center", gap:4, background:`${c.accent}10`, border:`1px solid ${c.accent}33`, borderRadius:14, padding:"5px 9px 5px 7px" }} title={`${SESSION.streak}-day streak${SESSION.bestStreak>SESSION.streak?` · Best: ${SESSION.bestStreak}`:""}`}>
                <svg width="12" height="14" viewBox="0 0 24 24" fill="#FF6B35"><path d="M13.5 0.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67z"/></svg>
                <span style={{ fontSize:12, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.01em" }}>{SESSION.streak}</span>
              </div>
            )}
            <div style={{ display:"flex", alignItems:"center", gap:6, background:c.muted, border:`1px solid ${c.border}`, borderRadius:14, padding:"5px 10px 5px 8px", cursor:"default" }} title={energy < MAX_ENERGY ? `Refills 1 every 2h · Next in ${getTimeToNextRefill()||"soon"}` : "Energy full"}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill={energy>0?c.accent:c.sub}><polygon points="13 2 4 14 11 14 10 22 20 10 13 10"/></svg>
              <span style={{ fontSize:13, fontWeight:800, color:energy>0?c.text:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.01em" }}>{energy}</span>
              <span style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>/ {MAX_ENERGY}</span>
            </div>
          </div>
        </div>

        {/* Bonus toast — slides in when user earns extra reveals */}
        {bonusToast && (
          <div style={{ position:"absolute", top:50, left:"50%", transform:"translateX(-50%)", zIndex:300, background:c.accent, color:"#FFFFFF", padding:"10px 16px", borderRadius:14, boxShadow:`0 6px 24px ${c.accent}55`, display:"flex", alignItems:"center", gap:8, fontFamily:"'DM Sans',sans-serif", fontWeight:700, fontSize:13, animation:"slideDown 0.35s cubic-bezier(0.34,1.2,0.64,1) both" }}>
            {bonusToast.amount > 0 && <><svg width="14" height="14" viewBox="0 0 24 24" fill="#FFFFFF"><polygon points="13 2 4 14 11 14 10 22 20 10 13 10"/></svg><span>+{bonusToast.amount}</span></>}
            <span style={{ opacity:0.95 }}>{bonusToast.reason}</span>
          </div>
        )}

        {/* Search bar */}
        <div style={{ padding:"0 20px 16px" }}>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1, display:"flex", alignItems:"center", gap:10, background:c.inputBg, border:`1.5px solid ${c.inputBorder}`, borderRadius:14, padding:"12px 16px", transition:"border-color 0.2s" }}>
              <Ico.Search s={14} c={c.sub}/>
              <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&query.trim()&&onSearch(query)} placeholder={hint||"Search deals..."} style={{ flex:1, background:"none", border:"none", outline:"none", fontSize:14, color:c.text, fontFamily:"'DM Sans',sans-serif" }}
                onFocus={e=>e.currentTarget.parentNode.style.borderColor=c.accent} onBlur={e=>e.currentTarget.parentNode.style.borderColor=c.inputBorder}/>
            </div>
            <button onClick={()=>query.trim()&&onSearch(query)} style={{ width:48, background:query.trim()?c.btnBg:c.muted, border:"none", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", cursor:query.trim()?"pointer":"default", flexShrink:0 }}>
              <Ico.Search s={16} c={query.trim()?c.btnText:c.sub}/>
            </button>
          </div>
        </div>

        {/* For You / Following toggle */}
        <div style={{ padding:"0 20px 12px" }}>
          <div style={{ display:"flex", gap:0, background:c.muted, borderRadius:11, padding:3, border:`1px solid ${c.border}` }}>
            {[
              {k:"foryou",    label:"For You"},
              {k:"following", label:`Following${SESSION.following.size>0?` (${SESSION.following.size})`:""}`},
            ].map(t=>(
              <button key={t.k} onClick={()=>{ setFeedFilter(t.k); SESSION.feedFilter=t.k; }} style={{ flex:1, padding:"8px 0", background:feedFilter===t.k?c.bg:"transparent", border:"none", borderRadius:9, fontSize:12, fontWeight:feedFilter===t.k?700:500, color:feedFilter===t.k?c.accent:c.sub, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", transition:"all 0.18s", boxShadow:feedFilter===t.k?"0 1px 4px rgba(0,0,0,0.08)":"none" }}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* Category filter */}
        <div style={{ paddingBottom:16, overflowX:"auto", scrollbarWidth:"none" }}>
          <div style={{ display:"flex", gap:8, paddingLeft:20, paddingRight:20 }}>
            {[{key:"all",label:"All"},...CATS].map(cat=>{
              const active=activeCat===cat.key;
              return (
                <button key={cat.key} onClick={()=>setActiveCat(cat.key)} style={{ flexShrink:0, display:"flex", alignItems:"center", gap:6, padding:"7px 14px", background:active?c.btnBg:c.pill, color:active?c.btnText:c.sub, border:`1px solid ${active?"transparent":c.pillBorder}`, borderRadius:20, fontSize:12, fontWeight:600, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", transition:"all 0.2s" }}>
                  {cat.key!=="all"&&<CatIcon cat={cat.key} color={active?c.btnText:c.sub} size={13}/>}
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Deal stack */}
        <div style={{ padding:"0 20px", display:"flex", flexDirection:"column", gap:14 }}>
          {filtered.length===0 && feedFilter==="following" && (
            <div style={{ textAlign:"center", padding:"48px 24px", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
              <div style={{ width:56, height:56, borderRadius:16, background:c.muted, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={c.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
              </div>
              <div style={{ fontSize:15, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>You're not following anyone yet</div>
              <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6, maxWidth:240 }}>Tap a username on any post and follow them to see their deals here.</div>
            </div>
          )}
          {filtered.length===0 && feedFilter!=="following" && (
            <div style={{ textAlign:"center", padding:"48px 24px", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
              <div style={{ width:56, height:56, borderRadius:16, background:c.muted, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <TagMark size={28} fill={c.sub} holeBg={c.muted}/>
              </div>
              <div style={{ fontSize:15, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>No deals yet</div>
              <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6 }}>No verified deals in this category yet. Be the first to post one.</div>
            </div>
          )}
          {filtered.map(deal => (
            <DealCard
              key={deal.id}
              deal={deal}
              c={c}
              theme={theme}
              claimed={claimed.has(deal.id)}
              onClaim={handleClaim}
              vote={votes[deal.id]||null}
              onVote={handleVote}
              bookmarked={bookmarked.has(deal.id)}
              onBookmark={handleBmark}
              onUserTap={onUserTap}
              onLocationTap={onLocationTap}
              onOpenPost={onOpenPost}
              limitReached={limitReached}
              isOwn={deal.user.id === getMe().id}
              onShareBonus={(amt)=>{ setEnergy(SESSION.revealEnergy); sfx.earn(); showBonus(amt, "Thanks for sharing!"); }}
              onPostBetter={onPostBetter}
            />
          ))}
        </div>

        {/* Partner CTA */}
        <div style={{ padding:"20px 20px 0" }}>
          <button
            type="button"
            onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); onPartnerRequest && onPartnerRequest(); }}
            style={{ width:"100%", background:c.accent, borderRadius:20, padding:"22px 20px", position:"relative", overflow:"hidden", cursor:"pointer", border:"none", textAlign:"left", display:"block", WebkitTapHighlightColor:"transparent" }}
          >
            <div style={{ position:"absolute", right:-18, top:"50%", transform:"translateY(-50%)", opacity:0.08, pointerEvents:"none" }}><TagMark size={100} fill="#FFFFFF" holeBg="transparent"/></div>
            <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.55)", letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:8, fontFamily:"'DM Sans',sans-serif" }}>For Business</div>
            <div style={{ fontSize:18, fontWeight:700, color:"#FFFFFF", lineHeight:1.3, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.01em", marginBottom:14, maxWidth:210 }}>Have a better price? Jump to the top.</div>
            <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"#FFFFFF", borderRadius:10, padding:"9px 16px", pointerEvents:"none" }}>
              <span style={{ fontSize:13, fontWeight:700, color:c.accent, fontFamily:"'DM Sans',sans-serif" }}>Join as a partner</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </div>
          </button>
        </div>

        <div style={{ height:20 }}/>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST A DEAL
// ─────────────────────────────────────────────────────────────────────────────
function PostDeal({ theme, lang, onBack, onSubmit, prefill=null, onClearPrefill }) {
  const [step, setStep]         = useState("form");
  const [subject, setSubject]   = useState("");
  const [place, setPlace]       = useState(prefill?.place||"");
  const [district, setDistrict] = useState(prefill?.district||"");
  const [cat, setCat]           = useState(prefill?.cat||"");
  const [platform, setPlatform] = useState(prefill?.platform||"");
  const [items, setItems]       = useState([{ n:"", p:"" }]);
  const [on, setOn]             = useState(false);
  const c = TH[theme];
  useEffect(()=>{ if(prefill&&onClearPrefill) onClearPrefill(); },[]);
  useEffect(()=>{setTimeout(()=>setOn(true),60);},[]);
  const a = d => on?{animation:`fu .45s ease ${d}s both`}:{opacity:0};
  const is = inp(c);

  const PLATFORM_OPTIONS = [
    { key:"talabat", label:"Talabat",  color:"#FF6B35" },
    { key:"snoonu",  label:"Snoonu",   color:"#7C3AED" },
    { key:"careem",  label:"Careem",   color:"#16A34A" },
    { key:"rafeeq",  label:"Rafeeq",   color:"#0284C7" },
    { key:"store",   label:"In Store", color:"#B8860B" },
    { key:"other",   label:"Other",    color:"#888888" },
  ];

  const addItem    = () => setItems(x=>[...x,{n:"",p:""}]);
  const updateItem = (i,f,v) => setItems(x=>x.map((it,idx)=>idx===i?{...it,[f]:v}:it));
  const removeItem = (i) => setItems(x=>x.filter((_,idx)=>idx!==i));
  const ready      = subject && place && district && cat && platform && items.some(it=>it.n&&it.p);

  const handleSubmit = () => {
    if (!ready) return;
    const post = { subject, place, district, cat, platform, items:items.filter(i=>i.n&&i.p), address:district };
    onSubmit && onSubmit(post);
    setStep("submitted");
    setTimeout(()=>{ onBack(); }, 2200);
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", position:"relative" }}>

      {/* ── Submitted toast — covers form entirely ── */}
      {step==="submitted" && (
        <div style={{ position:"absolute", inset:0, zIndex:100, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 28px", background:TH[theme].bg }}>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, animation:"scaleIn 0.45s cubic-bezier(0.34,1.56,0.64,1) both" }}>
            <div style={{ width:64, height:64, borderRadius:20, background:"#16A34A15", border:"2px solid #16A34A44", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Ico.Check s={30} c="#16A34A"/>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:18, fontWeight:700, color:TH[theme].text, fontFamily:"'DM Sans',sans-serif", marginBottom:6 }}>Deal Submitted ✓</div>
              <div style={{ fontSize:13, color:TH[theme].sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6 }}>In the review queue — going back to feed</div>
            </div>
          </div>
        </div>
      )}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 20px 32px" }}>

        {/* Header */}
        <div style={{ ...a(0.04), display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
          <span style={{ fontSize:18, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>Post a Deal</span>
        </div>

        {/* Subject */}
        <div style={{ ...a(0.08), marginBottom:10 }}>
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Your Hot Take</div>
          <textarea value={subject} onChange={e=>{ const v=e.target.value.replace(/[0-9]/g,""); setSubject(v); }} placeholder="Why is this deal worth sharing? Be specific. No prices — that's what the reveal is for." style={{ ...is, minHeight:90, resize:"none", lineHeight:1.5 }} onFocus={e=>e.target.style.borderColor=c.accent} onBlur={e=>e.target.style.borderColor=c.inputBorder}/>
        </div>

        {/* Category */}
        <div style={{ ...a(0.1), marginBottom:10 }}>
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Category</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
            {CATS.map(item=>{
              const active=cat===item.key;
              return (
                <button key={item.key} onClick={()=>setCat(item.key)} style={{ aspectRatio:"1", background:active?c.btnBg:c.surface, border:`1.5px solid ${active?"transparent":c.border}`, borderRadius:14, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:7, cursor:"pointer", transition:"all 0.2s", boxShadow:active?`0 4px 16px ${c.accent}22`:"none" }}>
                  <CatIcon cat={item.key} color={active?c.btnText:c.sub} size={20}/>
                  <span style={{ fontSize:11, fontWeight:700, color:active?c.btnText:c.text, fontFamily:"'DM Sans',sans-serif" }}>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Platform source */}
        <div style={{ ...a(0.12), marginBottom:10 }}>
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Where did you find this?</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {PLATFORM_OPTIONS.map(p=>{
              const active = platform===p.key;
              return (
                <button key={p.key} onClick={()=>setPlatform(p.key)} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 14px", background:active?`${p.color}20`:"transparent", border:`1.5px solid ${active?p.color:c.border}`, borderRadius:20, cursor:"pointer", transition:"all 0.15s" }}>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:p.color }}/>
                  <span style={{ fontSize:12, fontWeight:active?700:500, color:active?p.color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Place + district */}
        <div style={{ ...a(0.12), marginBottom:10 }}>
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Location</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <input style={is} placeholder="Place name (e.g. Al Wakra Shawarma Palace)" value={place} onChange={e=>setPlace(e.target.value)} onFocus={e=>e.target.style.borderColor=c.accent} onBlur={e=>e.target.style.borderColor=c.inputBorder}/>
            <select value={district} onChange={e=>setDistrict(e.target.value)} style={{ ...is, cursor:"pointer", color:district?c.text:c.sub, appearance:"none" }}>
              <option value="" disabled>Select district</option>
              {DISTRICTS.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {/* Items */}
        <div style={{ ...a(0.14), marginBottom:10 }}>
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Items & Prices</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {items.map((item,i)=>(
              <div key={i} style={{ display:"flex", gap:8, alignItems:"center" }}>
                <input placeholder="Item name" value={item.n} onChange={e=>updateItem(i,"n",e.target.value)} style={{ ...is, flex:2 }} onFocus={e=>e.target.style.borderColor=c.accent} onBlur={e=>e.target.style.borderColor=c.inputBorder}/>
                <input placeholder="QAR" type="number" value={item.p} onChange={e=>updateItem(i,"p",e.target.value)} style={{ ...is, flex:1 }} onFocus={e=>e.target.style.borderColor=c.accent} onBlur={e=>e.target.style.borderColor=c.inputBorder}/>
                {items.length>1&&<button onClick={()=>removeItem(i)} style={{ background:"none", border:`1px solid ${c.border}`, borderRadius:10, width:38, height:50, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ico.Trash s={14} c={c.sub}/></button>}
              </div>
            ))}
            <button onClick={addItem} style={{ background:"transparent", border:`1px dashed ${c.border}`, borderRadius:12, padding:"11px 0", fontSize:13, fontWeight:600, color:c.sub, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>+ Add another item</button>
          </div>
        </div>

        {/* Submit */}
        <div style={a(0.22)}>
          <Btn onClick={handleSubmit} theme={theme} style={{ opacity:ready?1:0.3 }}>
            Submit for Review
          </Btn>
          {getMe().founder && ready && <div style={{ textAlign:"center", fontSize:11, color:"#1D6FEB", fontFamily:"'DM Sans',sans-serif", marginTop:8, fontWeight:600 }}>Founder post — will appear in review queue</div>}
          {!ready && <div style={{ textAlign:"center", fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:8 }}>Fill in all fields to continue</div>}
        </div>
        <div style={{ height:8 }}/>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────────────────────────────────────
function Profile({ theme, lang, user:userProp, onBack, showBack=false, onSignOut, onNotifications, onSettings, unreadCount=0, onViewFollowing }) {
  const resolvedUser = userProp || getMe();
  const [on, setOn]                 = useState(false);
  const [following, setFollowing]   = useState(SESSION.following.has(resolvedUser.id));
  const [followAnim, setFollowAnim] = useState(false);
  const c = TH[theme]; const ar = lang==="ar";
  const user = resolvedUser;
  const isOwn = user.id === getMe().id;
  useEffect(()=>{setTimeout(()=>setOn(true),80);},[]);
  useEffect(()=>{ setFollowing(SESSION.following.has(user.id)); }, [user.id]);
  const a = d => on?{animation:`fu .45s ease ${d}s both`}:{opacity:0};
  const myDeals = DEALS.filter(d=>d.user.id===user.id);
  const rank = RANKS[user.rank];

  const handleFollow = () => {
    setFollowAnim(true);
    setTimeout(()=>setFollowAnim(false),500);
    if (SESSION.following.has(user.id)) {
      sfx.voteDown();
      SESSION.following.delete(user.id);
      setFollowing(false);
    } else {
      sfx.voteUp();
      SESSION.following.add(user.id);
      setFollowing(true);
    }
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ flex:1, overflowY:"auto", paddingBottom:24 }}>

        {/* Header */}
        {showBack ? (
          <div style={{ padding:"12px 20px 0", ...a(0.0) }}>
            <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
          </div>
        ) : isOwn && (
          <div style={{ padding:"12px 20px 0", display:"flex", alignItems:"center", justifyContent:"space-between", ...a(0.0) }}>
            <span style={{ fontSize:18, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>Profile</span>
            <div style={{ display:"flex", gap:8 }}>
              {/* Bell */}
              <button onClick={onNotifications} style={{ width:38, height:38, borderRadius:11, background:c.surface, border:`1px solid ${c.border}`, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                {unreadCount > 0 && (
                  <div style={{ position:"absolute", top:6, right:6, width:8, height:8, borderRadius:"50%", background:c.accent }}/>
                )}
              </button>
              {/* Settings */}
              <button onClick={onSettings} style={{ width:38, height:38, borderRadius:11, background:c.surface, border:`1px solid ${c.border}`, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* Profile card */}
        <div style={{ padding:"20px 20px 0", ...a(0.06) }}>
          <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:20, padding:"24px 20px" }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
              <Avatar user={user} size={56}/>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <span style={{ fontSize:18, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{user.username}</span>
                  <TierBadge user={user} size="md"/>
                  {(()=>{ const b=getBetaBadge(user.id); return b ? <span style={{ fontSize:10, fontWeight:800, color:b.color, background:b.bg, border:`1px solid ${b.border}`, borderRadius:6, padding:"2px 8px", fontFamily:"'DM Sans',sans-serif" }}>β {b.label}</span> : null; })()}
                </div>
                {user.name && <div style={{ fontSize:13, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{user.name}</div>}
                {user.caption && <div style={{ fontSize:13, color:c.text, fontFamily:"'DM Sans',sans-serif", marginTop:6, lineHeight:1.4 }}>{user.caption}</div>}
              </div>
            </div>

            {/* Follow / Report buttons for other profiles */}
            {!isOwn && (
              <div style={{ display:"flex", gap:10, marginTop:16, paddingTop:16, borderTop:`1px solid ${c.border}` }}>
                <button onClick={handleFollow} style={{ flex:1, padding:"11px 0", background:following?c.muted:c.accent, border:`1px solid ${following?c.border:"transparent"}`, borderRadius:12, fontSize:13, fontWeight:700, color:following?c.text:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", cursor:"pointer", transition:"all 0.2s", animation:followAnim?"upBurst 0.45s ease both":"none", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                  {following && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={c.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  {following?"Following":"Follow"}
                </button>
                <button style={{ width:44, height:44, background:"transparent", border:`1px solid ${c.border}`, borderRadius:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c.sub} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                </button>
              </div>
            )}

            {/* Stats */}
            <div style={{ display:"flex", marginTop:20, paddingTop:16, borderTop:`1px solid ${c.border}` }}>
              {[
                { label:"Posts",      val: user.deals,                                              onClick:null },
                { label:"Followers",  val: user.followers,                                          onClick:null },
                { label:"Following",  val: isOwn ? SESSION.following.size : (user.following||0),    onClick: isOwn ? onViewFollowing : null },
                { label:"Total Ups",  val: user.deals>0 ? user.deals*12 : 0,                        onClick:null },
              ].map((s,i)=>(
                <button key={i} onClick={s.onClick||undefined} disabled={!s.onClick} style={{ flex:1, textAlign:"center", borderRight:i<3?`1px solid ${c.border}`:"none", background:"transparent", border:"none", padding:"4px 0", cursor:s.onClick?"pointer":"default", borderTop:"none", borderBottom:"none", borderLeft:"none" }}>
                  <div style={{ fontSize:17, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{s.val}</div>
                  <div style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{s.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Streak card — only on own profile, only when active */}
        {isOwn && SESSION.streak > 0 && (
          <div style={{ padding:"12px 20px 0", ...a(0.10) }}>
            <div style={{ position:"relative", overflow:"hidden", background:`linear-gradient(135deg,${c.surface} 0%,${c.accent}08 100%)`, border:`1px solid ${c.accent}30`, borderRadius:14, padding:"13px 16px", display:"flex", alignItems:"center", gap:14 }}>
              <div style={{ position:"absolute", top:-12, right:-12, width:80, height:80, borderRadius:"50%", background:`${c.accent}10`, pointerEvents:"none" }}/>
              <div style={{ position:"relative", width:42, height:42, borderRadius:12, background:"linear-gradient(135deg,#FF6B35,#F59E0B)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow:"0 3px 14px rgba(255,107,53,0.35)" }}>
                <svg width="18" height="22" viewBox="0 0 24 24" fill="#FFFFFF"><path d="M13.5 0.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>
              </div>
              <div style={{ flex:1, position:"relative" }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                  <span style={{ fontSize:22, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.03em", lineHeight:1 }}>{SESSION.streak}</span>
                  <span style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>day streak</span>
                </div>
                <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:3 }}>
                  {SESSION.lastRevealDate === todayKey() ? "Active today · Keep it going tomorrow" : "Reveal a deal today to extend"}
                  {SESSION.bestStreak > SESSION.streak ? ` · Best: ${SESSION.bestStreak}` : ""}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Beta tier card */}
        {(()=>{ const b=getBetaBadge(user.id); return b ? (
          <div style={{ padding:"12px 20px 0", ...a(0.12) }}>
            <div style={{ background:b.bg, border:`1px solid ${b.border}`, borderRadius:14, padding:"12px 14px", display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:b.bg, border:`1.5px solid ${b.border}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <span style={{ fontSize:18 }}>β</span>
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:800, color:b.color, fontFamily:"'DM Sans',sans-serif" }}>{b.label} BETA TESTER</div>
                <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{b.desc} — founding member of BKM</div>
              </div>
            </div>
          </div>
        ) : null; })()}

        {/* Their deals */}
        <div style={{ padding:"16px 20px 0", ...a(0.14) }}>
          <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:12 }}>
            {user.id===ME.id?"Your Deals":"Their Deals"}
          </div>
          {myDeals.length===0 && (
            <div style={{ textAlign:"center", padding:"24px 0", color:c.sub, fontFamily:"'DM Sans',sans-serif", fontSize:13 }}>
              {user.id===ME.id?"You haven't posted any deals yet.":"No deals posted yet."}
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {myDeals.map(deal=>(
              <div key={deal.id} style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:14, padding:"12px 14px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <img src={deal.img} alt="" style={{ width:44, height:44, borderRadius:10, objectFit:"cover", flexShrink:0 }} onError={e=>e.target.style.display="none"}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{deal.subject.slice(0,55)}...</div>
                    <div style={{ fontSize:11, color:c.sub, marginTop:3, fontFamily:"'DM Sans',sans-serif" }}>{deal.district} · {deal.ups} up · {deal.claims} claims</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {isOwn && (
          <div style={{ padding:"16px 20px 0", ...a(0.2) }}>
            <div style={{ background:"#F59E0B10", border:"1px solid #F59E0B33", borderRadius:12, padding:"12px 14px", display:"flex", gap:10, alignItems:"flex-start" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:1 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:"#F59E0B", fontFamily:"'DM Sans',sans-serif", marginBottom:3 }}>BKM Beta</div>
                <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.5 }}>Prices are user-submitted and unverified. Features may change. Data may be reset.</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCATION PAGE
// ─────────────────────────────────────────────────────────────────────────────
function LocationPage({ district, theme, lang, onBack, onUserTap }) {
  const [on, setOn] = useState(false);
  const c = TH[theme];
  const deals = DEALS.filter(d=>d.district===district);
  useEffect(()=>{setTimeout(()=>setOn(true),60);},[]);
  const a = d => on?{animation:`fu .4s ease ${d}s both`}:{opacity:0};

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ flex:1, overflowY:"auto", padding:"12px 0 24px" }}>
        <div style={{ padding:"4px 20px 16px", display:"flex", alignItems:"center", gap:12, ...a(0.04) }}>
          <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
          <div>
            <div style={{ fontSize:20, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{district}</div>
            <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{deals.length} verified deals</div>
          </div>
        </div>

        {deals.length===0 ? (
          <div style={{ textAlign:"center", padding:"48px 24px", color:c.sub, fontFamily:"'DM Sans',sans-serif", fontSize:13, lineHeight:1.6 }}>
            No deals yet for this area.<br/>Be the first to post one.
          </div>
        ) : (
          <div style={{ padding:"0 20px", display:"flex", flexDirection:"column", gap:12 }}>
            {deals.map((deal,i)=>(
              <div key={deal.id} style={{ ...a(0.08+i*0.04), background:c.surface, border:`1px solid ${c.border}`, borderRadius:16, overflow:"hidden" }}>
                <img src={deal.img} alt="" style={{ width:"100%", height:100, objectFit:"cover", display:"block" }} onError={e=>e.target.style.display="none"}/>
                <div style={{ padding:"12px 14px" }}>
                  <button onClick={()=>onUserTap(deal.user)} style={{ display:"flex", alignItems:"center", gap:8, background:"none", border:"none", cursor:"pointer", padding:"0 0 8px 0" }}>
                    <Avatar user={deal.user} size={28}/>
                    <span style={{ fontSize:12, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{deal.user.username}</span>
                    <span style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>· {RANKS[deal.user.rank]?.label}</span>
                  </button>
                  <div style={{ fontSize:13, color:c.text, fontFamily:"'DM Sans',sans-serif", lineHeight:1.4, marginBottom:8 }}>{deal.subject.slice(0,80)}...</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {deal.items.map((item,j)=>(
                      <div key={j} style={{ background:c.muted, borderRadius:8, padding:"4px 10px", display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:11, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{item.n}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:c.accent, fontFamily:"'DM Sans',sans-serif" }}>QAR {Number(item.p).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOWING LIST — view people the current user follows, with quick unfollow
// ─────────────────────────────────────────────────────────────────────────────
function FollowingList({ theme, lang, onBack, onUserTap }) {
  const c = TH[theme];
  // Build the list from SESSION.following + USERS lookup
  const [followingIds, setFollowingIds] = useState(Array.from(SESSION.following));

  const unfollow = (id) => {
    SESSION.following.delete(id);
    setFollowingIds(Array.from(SESSION.following));
  };

  const followingUsers = followingIds
    .map(id => USERS.find(u => u.id === id) || (id===0 ? getMe() : null))
    .filter(Boolean);

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ padding:"14px 20px 10px", borderBottom:`1px solid ${c.border}`, flexShrink:0, display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
        <div>
          <div style={{ fontSize:16, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.01em" }}>Following</div>
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>{followingUsers.length} {followingUsers.length===1?"person":"people"}</div>
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"14px 16px 24px" }}>
        {followingUsers.length === 0 ? (
          <div style={{ textAlign:"center", padding:"60px 24px", display:"flex", flexDirection:"column", alignItems:"center", gap:14 }}>
            <div style={{ width:60, height:60, borderRadius:18, background:c.muted, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={c.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            </div>
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:6 }}>You're not following anyone yet</div>
              <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6, maxWidth:240 }}>Tap a username on any post and follow them to see their deals first.</div>
            </div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {followingUsers.map(u => (
              <div key={u.id} style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:13, padding:"10px 12px", display:"flex", alignItems:"center", gap:12 }}>
                <button onClick={()=>onUserTap && onUserTap(u)} style={{ display:"flex", alignItems:"center", gap:10, flex:1, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"left" }}>
                  <Avatar user={u} size={38}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{u.username}</span>
                      <TierBadge user={u} size="sm"/>
                    </div>
                    <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.caption || `${u.followers||0} followers`}</div>
                  </div>
                </button>
                <button onClick={()=>unfollow(u.id)} style={{ padding:"7px 14px", background:"transparent", border:`1.5px solid ${c.border}`, borderRadius:9, fontSize:11, fontWeight:600, color:c.sub, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", flexShrink:0 }}>Unfollow</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH TAB
// ─────────────────────────────────────────────────────────────────────────────
function SearchTab({ theme, lang, onLocationTap, initialQuery="" }) {
  const [query, setQuery]         = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [focused, setFocused]     = useState(false);
  const [sortBy, setSortBy]       = useState("price");
  const [filterType, setFilterType] = useState("all"); // all | users | locations | stores | items
  const inputRef                  = useRef(null);
  const hint                      = useTyping(HINTS);
  const c = TH[theme];

  const getResults = (q) => {
    const queryLow = q.toLowerCase().trim();
    if (!queryLow) return [];
    // Filter out tokens that are pure size/unit suffixes (x12, 5kg, 1l, 500mg, etc) and short tokens
    const STOP = /^(x?\d+(kg|g|ml|l|mg|oz|lb|pc|pcs)?|the|and|of|with|or)$/i;
    const allWords = queryLow.split(/\s+/).filter(w=>w.length>0);
    const meaningfulWords = allWords.filter(w => w.length >= 3 && !STOP.test(w));
    // If user typed only short/stop tokens, fall back to using all words
    const words = meaningfulWords.length > 0 ? meaningfulWords : allWords;

    const candidates = [];
    Object.values(SEARCH_RESULTS).flat().forEach(r => candidates.push({ ...r, _source: "search" }));
    DEALS.forEach(deal => {
      deal.items.forEach(item => candidates.push({
        item: item.n, vendor: deal.place, platform: deal.platform, district: deal.district,
        price: item.p, deliveryFee: 0,
        rating: (deal.ups / Math.max(1, deal.ups+deal.downs)) * 5,
        verified: deal.verified !== false,
        postedBy: deal.user.username, rank: deal.user.rank, img: deal.img,
        cat: deal.cat, _source: "feed", _dealId: deal.id,
      }));
    });
    MERCHANT_LISTINGS.forEach(listing => candidates.push({
      item: listing.name, vendor: listing.merchant, platform: "store", district: "",
      price: listing.price, deliveryFee: 0, rating: 5, verified: true,
      postedBy: listing.merchant, rank: 4, img: "", cat: listing.cat || "stores",
      _source: "merchant",
    }));

    // Score every candidate. CRITICAL: every word in the query must match somewhere.
    const scored = candidates.map(r => {
      const itemName   = (r.item||"").toLowerCase();
      const vendorName = (r.vendor||"").toLowerCase();
      const platform   = (r.platform||"").toLowerCase();
      const postedBy   = (r.postedBy||"").toLowerCase();
      const haystack   = `${itemName} ${vendorName} ${platform} ${postedBy}`;

      // Require ALL meaningful words to appear somewhere
      const allMatch = words.every(w => haystack.includes(w));
      if (!allMatch) return { ...r, _score: 0 };

      let score = 0;
      // Bonus for exact phrase match
      if (itemName === queryLow)            score += 200;
      if (itemName.startsWith(queryLow))    score += 80;
      if (itemName.includes(queryLow))      score += 50;
      if (vendorName === queryLow)          score += 100;

      words.forEach(w => {
        if (itemName === w)                 score += 100;
        if (itemName.startsWith(w))         score += 60;
        if (itemName.includes(w))           score += 40;
        if (vendorName.startsWith(w))       score += 30;
        if (vendorName.includes(w))         score += 20;
        if (platform.includes(w))           score += 8;
        if (postedBy === w)                 score += 50;
      });
      if (r._source === "merchant") score += 5;
      return { ...r, _score: score };
    });

    const seen = new Map();
    scored.forEach(r => {
      const key = `${r.item}__${r.vendor}`;
      if (!seen.has(key) || seen.get(key)._score < r._score) seen.set(key, r);
    });
    return Array.from(seen.values())
      .filter(r => r._score > 0 && r.verified !== false)
      .sort((a,b) => b._score - a._score || a.price - b.price)
      .slice(0, 12);
  };

  // User search — searches across USERS array
  const getUserResults = (q) => {
    const query = q.toLowerCase().trim();
    if (!query) return [];
    const words = query.split(/\s+/);
    return USERS
      .map(u => {
        let score = 0;
        const uname = (u.username||"").toLowerCase();
        const name  = (u.name||"").toLowerCase();
        const cap   = (u.caption||"").toLowerCase();
        words.forEach(w => {
          if (uname === w)         score += 100;
          if (uname.startsWith(w)) score += 60;
          if (uname.includes(w))   score += 40;
          if (name.includes(w))    score += 30;
          if (cap.includes(w))     score += 10;
        });
        return { ...u, _score:score };
      })
      .filter(u => u._score > 0)
      .sort((a,b) => b._score - a._score);
  };

  // Location/store search across DEALS and MERCHANT_LISTINGS
  const getLocationResults = (q) => {
    const query = q.toLowerCase().trim();
    if (!query) return [];
    const words = query.split(/\s+/);

    const dealMatches = DEALS
      .map(d => {
        let score = 0;
        const place    = (d.place||"").toLowerCase();
        const district = (d.district||"").toLowerCase();
        const address  = (d.address||"").toLowerCase();
        words.forEach(w => {
          if (place === w)         score += 100;
          if (place.startsWith(w)) score += 60;
          if (place.includes(w))   score += 40;
          if (district === w)      score += 80;
          if (district.includes(w))score += 30;
          if (address.includes(w)) score += 20;
        });
        return { ...d, _score:score };
      })
      .filter(d => d._score > 0);

    // Deduplicate by place name
    const seen = new Map();
    dealMatches.forEach(d => {
      if (!seen.has(d.place) || seen.get(d.place)._score < d._score) seen.set(d.place, d);
    });
    return Array.from(seen.values()).sort((a,b)=>b._score - a._score);
  };

  const doSearch = (q) => {
    const s = (q !== undefined ? q : query).trim();
    if (!s) return;
    setQuery(s);
    setSubmitted(s);
    setFocused(false);
    setFilterType("all");
    setSortBy("price");
    inputRef.current?.blur();
  };

  const clear = () => { setQuery(""); setSubmitted(""); setFocused(false); setFilterType("all"); };

  const rawResults      = submitted ? getResults(submitted)      : [];
  const userResults     = submitted ? getUserResults(submitted)   : [];
  const locationResults = submitted ? getLocationResults(submitted) : [];
  const sorted = [...rawResults].sort((a,b) => {
    if (sortBy==="price") return a.price - b.price;
    if (sortBy==="total") return (a.price+a.deliveryFee) - (b.price+b.deliveryFee);
    return b.rating - a.rating;
  });
  const lowest  = rawResults.length ? Math.min(...rawResults.map(r=>r.price)) : 0;
  const highest = rawResults.length ? Math.max(...rawResults.map(r=>r.price)) : 0;
  const saving  = (highest - lowest).toFixed(2);

  const FILTER_TYPES = [
    { key:"all",       label:"All Results" },
    { key:"items",     label:"Items"       },
    { key:"stores",    label:"Stores"      },
    { key:"locations", label:"Locations"   },
    { key:"users",     label:"Users"       },
  ];

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>

      {/* Search bar — always visible */}
      <div style={{ padding:"8px 16px 10px", flexShrink:0 }}>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {submitted && (
            <button onClick={clear} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px", flexShrink:0 }}>
              <Ico.Back s={18} c={c.sub}/>
            </button>
          )}
          <div style={{ flex:1, display:"flex", alignItems:"center", gap:9, background:c.surface, border:`1.5px solid ${focused||submitted?c.accent:c.border}`, borderRadius:14, padding:"12px 14px", transition:"border-color 0.2s" }}>
            <Ico.Search s={16} c={focused||submitted?c.accent:c.sub}/>
            <input
              ref={inputRef}
              value={query}
              onChange={e=>setQuery(e.target.value)}
              onFocus={()=>setFocused(true)}
              onBlur={()=>setTimeout(()=>setFocused(false),200)}
              onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); doSearch(query); } }}
              placeholder={hint||"Search for the best price..."}
              style={{ flex:1, background:"none", border:"none", fontSize:16, color:c.text, fontFamily:"'DM Sans',sans-serif", outline:"none", minWidth:0 }}
            />
            {query && (
              <button onMouseDown={e=>{e.preventDefault();clear();}} style={{ background:"none", border:"none", cursor:"pointer", color:c.sub, fontSize:13, flexShrink:0 }}>✕</button>
            )}
          </div>
          {/* Search button — onMouseDown fires before input blur */}
          <button
            onMouseDown={e=>{ e.preventDefault(); doSearch(query); }}
            style={{ width:44, height:44, background:query.trim()?c.accent:c.muted, border:"none", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", cursor:query.trim()?"pointer":"default", flexShrink:0, transition:"background 0.2s" }}
          >
            <Ico.Search s={16} c={query.trim()?"#FFFFFF":c.sub}/>
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex:1, overflowY:"auto" }}>

        {/* ── DEFAULT STATE ── */}
        {!submitted && !focused && (
          <div style={{ animation:"fu 0.3s ease both" }}>

            {/* Nearby */}
            <div style={{ marginBottom:20 }}>
              <div style={{ padding:"0 16px 10px" }}>
                <div style={{ fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>Near You</div>
                <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:1, display:"flex", alignItems:"center", gap:4 }}>
                  <Ico.Pin s={10} c={c.sub}/> The Pearl, Doha
                </div>
              </div>
              <div style={{ display:"flex", gap:12, paddingLeft:16, paddingRight:16, overflowX:"auto", scrollbarWidth:"none", paddingBottom:4 }}>
                {NEARBY.map((place,i) => {
                  const P = PLATFORMS[place.platform];
                  return (
                    <button key={i} onMouseDown={e=>{e.preventDefault();doSearch(place.topItem);}} style={{ flexShrink:0, width:165, background:c.surface, border:`1px solid ${c.border}`, borderRadius:16, overflow:"hidden", cursor:"pointer", textAlign:"left" }}>
                      <img src={place.img} alt="" style={{ width:"100%", height:88, objectFit:"cover", display:"block" }} onError={e=>e.target.style.display="none"}/>
                      <div style={{ padding:"9px 11px" }}>
                        <div style={{ fontSize:12, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{place.name}</div>
                        <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:3 }}>
                          <Ico.Pin s={9} c={c.sub}/>
                          <span style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>{place.district}</span>
                          <span style={{ fontSize:9, color:c.sub }}>·</span>
                          <span style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>{place.deals} deals</span>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:7 }}>
                          <div>
                            <div style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:80 }}>{place.topItem}</div>
                            <div style={{ fontSize:14, fontWeight:800, color:c.accent, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>QAR {place.price}</div>
                          </div>
                          <div style={{ background:`${P.color}15`, border:`1px solid ${P.color}30`, borderRadius:6, padding:"2px 6px" }}>
                            <span style={{ fontSize:9, fontWeight:700, color:P.color, fontFamily:"'DM Sans',sans-serif" }}>{P.label}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Top 5 */}
            <div style={{ padding:"0 16px", marginBottom:20 }}>
              <div style={{ fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:10 }}>Top 5 This Week</div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {TOP5_SEARCH.map((item,i) => {
                  const P = PLATFORMS[item.platform];
                  return (
                    <button key={i} onMouseDown={e=>{e.preventDefault();doSearch(item.name);}} style={{ display:"flex", alignItems:"center", gap:11, background:c.surface, border:`1px solid ${i===0?c.accent+"44":c.border}`, borderRadius:13, padding:"10px 12px", cursor:"pointer", textAlign:"left", position:"relative" }}>
                      {i===0 && <div style={{ position:"absolute", left:0, top:0, bottom:0, width:3, background:c.accent, borderRadius:"13px 0 0 13px" }}/>}
                      <span style={{ fontSize:13, fontWeight:800, color:i===0?c.accent:c.sub, width:18, fontFamily:"'DM Sans',sans-serif", textAlign:"center", flexShrink:0 }}>{i+1}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.name}</div>
                        <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{item.vendor}</div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
                        <div style={{ background:`${P.color}15`, border:`1px solid ${P.color}30`, borderRadius:6, padding:"2px 6px" }}>
                          <span style={{ fontSize:9, fontWeight:700, color:P.color, fontFamily:"'DM Sans',sans-serif" }}>{P.label}</span>
                        </div>
                        <span style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>QAR {item.price}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category grid */}
            <div style={{ padding:"0 16px" }}>
              <div style={{ fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:10 }}>Browse by Category</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
                {CATS.map(cat => (
                  <button key={cat.key} onClick={()=>{ setQuery(cat.label); setTimeout(()=>doSearch(cat.label),50); }} style={{ aspectRatio:"1", background:c.surface, border:`1px solid ${c.border}`, borderRadius:16, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:7, cursor:"pointer", transition:"all 0.2s" }}
                    onMouseOver={e=>{ e.currentTarget.style.borderColor=c.accent+"55"; e.currentTarget.style.background=`${c.accent}08`; }}
                    onMouseOut={e=>{ e.currentTarget.style.borderColor=c.border; e.currentTarget.style.background=c.surface; }}
                  >
                    <CatIcon cat={cat.key} color={c.sub} size={22}/>
                    <span style={{ fontSize:11, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ height:20 }}/>
          </div>
        )}

        {/* ── TYPEAHEAD ── */}
        {focused && !submitted && (
          <div style={{ padding:"0 16px", animation:"fu 0.15s ease both" }}>
            <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10, fontFamily:"'DM Sans',sans-serif" }}>Suggestions</div>
            {SUGGESTIONS.filter(s=>!query||s.toLowerCase().includes(query.toLowerCase())).map(sug=>(
              <button key={sug} onMouseDown={e=>{e.preventDefault();doSearch(sug);}} style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"12px 0", background:"none", border:"none", borderBottom:`1px solid ${c.border}`, cursor:"pointer", textAlign:"left" }}>
                <Ico.Search s={13} c={c.sub}/>
                <span style={{ fontSize:14, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{sug}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── RESULTS ── */}
        {submitted && !focused && (
          <div style={{ animation:"fu 0.3s ease both" }}>

            {/* Result type filters */}
            <div style={{ paddingBottom:12, overflowX:"auto", scrollbarWidth:"none" }}>
              <div style={{ display:"flex", gap:7, paddingLeft:16, paddingRight:16 }}>
                {FILTER_TYPES.map(f => {
                  const active = filterType===f.key;
                  return (
                    <button key={f.key} onClick={()=>setFilterType(f.key)} style={{ flexShrink:0, padding:"7px 14px", background:active?c.btnBg:c.surface, color:active?c.btnText:c.sub, border:`1.5px solid ${active?"transparent":c.border}`, borderRadius:20, fontSize:12, fontWeight:700, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", transition:"all 0.18s", whiteSpace:"nowrap" }}>
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sort — only for All Results and Items */}
            {(filterType==="all"||filterType==="items") && (
              <div style={{ padding:"0 16px 12px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{submitted}</div>
                  <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>
                    {rawResults.length} results · save up to <span style={{ color:c.text, fontWeight:700 }}>QAR {saving}</span>
                  </div>
                </div>
                <div style={{ display:"flex", gap:4 }}>
                  {[{k:"price",l:"Price"},{k:"total",l:"Total"},{k:"rating",l:"Rating"}].map(s=>(
                    <button key={s.k} onClick={()=>setSortBy(s.k)} style={{ padding:"5px 9px", background:sortBy===s.k?c.accent:"transparent", border:`1px solid ${sortBy===s.k?"transparent":c.border}`, borderRadius:8, fontSize:10, fontWeight:700, color:sortBy===s.k?"#FFFFFF":c.sub, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", transition:"all 0.15s" }}>{s.l}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Price spread — all/items only */}
            {(filterType==="all"||filterType==="items") && (
              <div style={{ padding:"0 16px 14px" }}>
                <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:13, padding:"11px 13px" }}>
                  <div style={{ fontSize:10, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:7, fontFamily:"'DM Sans',sans-serif" }}>Price spread across platforms</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:13, fontWeight:800, color:c.accent, fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" }}>QAR {lowest}</span>
                    <div style={{ flex:1, height:5, borderRadius:99, background:c.muted, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:"100%", background:`linear-gradient(90deg,${c.accent},${c.border})`, borderRadius:99 }}/>
                    </div>
                    <span style={{ fontSize:13, fontWeight:600, color:c.sub, fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" }}>QAR {highest}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── All Results / Items view ── */}
            {(filterType==="all"||filterType==="items") && (
              <div style={{ padding:"0 16px", display:"flex", flexDirection:"column", gap:10 }}>
                {sorted.map((r,i) => {
                  const P = PLATFORMS[r.platform]; const best = i===0;
                  return (
                    <div key={i} style={{ background:best?`${c.accent}0C`:c.surface, border:`1.5px solid ${best?c.accent+"55":c.border}`, borderRadius:16, padding:"13px 13px", position:"relative", overflow:"hidden", animation:`fu 0.35s ease ${i*0.06}s both` }}>
                      {best && <div style={{ position:"absolute", top:0, left:0, right:0, height:2.5, background:`linear-gradient(90deg,${c.accent},transparent)` }}/>}
                      <div style={{ display:"flex", alignItems:"center", gap:11 }}>
                        <div style={{ width:22, height:22, borderRadius:7, background:best?c.accent:c.pill, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <span style={{ fontSize:11, fontWeight:800, color:best?"#FFFFFF":c.sub, fontFamily:"'DM Sans',sans-serif" }}>{i+1}</span>
                        </div>
                        <div style={{ width:46, height:46, borderRadius:11, background:best?`${c.accent}20`:c.muted, border:`1px solid ${best?c.accent+"40":c.border}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <CatIcon cat={r.cat || "stores"} color={best?c.accent:c.sub} size={22}/>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", lineHeight:1.3 }}>{r.item}</div>
                          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.vendor}</div>
                          <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:5 }}>
                            <div style={{ background:`${P.color}15`, border:`1px solid ${P.color}30`, borderRadius:6, padding:"2px 6px" }}>
                              <span style={{ fontSize:9, fontWeight:700, color:P.color, fontFamily:"'DM Sans',sans-serif" }}>{P.label}</span>
                            </div>
                            {r.verified && <span style={{ fontSize:9, color:c.accent, fontFamily:"'DM Sans',sans-serif", fontWeight:700 }}>✓ BKM Verified</span>}
                          </div>
                        </div>
                        <div style={{ textAlign:"right", flexShrink:0 }}>
                          <div style={{ fontSize:20, fontWeight:800, color:best?c.accent:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.03em", lineHeight:1 }}>{r.price.toFixed(2)}</div>
                          <div style={{ fontSize:9, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:1 }}>QAR</div>
                          <div style={{ fontSize:10, marginTop:3, fontFamily:"'DM Sans',sans-serif" }}>
                            {r.deliveryFee===0 ? <span style={{ color:"#16A34A", fontWeight:600 }}>Free delivery</span> : <span style={{ color:c.sub }}>+{r.deliveryFee} delivery</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${c.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <ColorAvatar user={{username:r.postedBy, av:r.postedBy}} size={18}/>
                          <span style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>by <span style={{ color:c.text, fontWeight:600 }}>{r.postedBy}</span></span>
                          <TierBadge user={{rank:r.rank, founder:false}} size="sm"/>
                        </div>
                        <span style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>{Number(r.rating||0).toFixed(1)}</span>
                      </div>
                      {best && (
                        <button style={{ marginTop:10, width:"100%", background:c.accent, border:"none", borderRadius:10, padding:"10px 0", fontSize:13, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>
                          Open in {P.label}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Users view ── */}
            {filterType==="users" && (
              <div style={{ padding:"0 16px", display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginBottom:4 }}>
                  {userResults.length ? `${userResults.length} user${userResults.length>1?"s":""} found` : "No users found for this search"}
                </div>
                {userResults.map((u,i) => (
                  <div key={i} style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:14, padding:"13px 14px", display:"flex", alignItems:"center", gap:12, animation:`fu 0.35s ease ${i*0.08}s both` }}>
                    <Avatar user={u} size={44}/>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{u.username}</div>
                      {u.name && <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:1 }}>{u.name}</div>}
                      {u.caption && <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2, fontStyle:"italic" }}>{u.caption}</div>}
                      <div style={{ display:"flex", gap:12, marginTop:6 }}>
                        <span style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}><span style={{ color:c.text, fontWeight:700 }}>{u.deals}</span> deals</span>
                        <span style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}><span style={{ color:c.text, fontWeight:700 }}>{u.followers>=1000?`${(u.followers/1000).toFixed(1)}k`:u.followers}</span> followers</span>
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <TierBadge user={u} size="sm"/>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Locations / Stores view ── */}
            {(filterType==="locations"||filterType==="stores") && (
              <div style={{ padding:"0 16px", display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginBottom:4 }}>
                  {locationResults.length ? `${locationResults.length} location${locationResults.length>1?"s":""} found` : "No locations found for this search"}
                </div>
                {locationResults.map((d,i) => {
                  const P = PLATFORMS[d.platform] || PLATFORM_META.store;
                  return (
                    <div key={i} style={{ background:c.surface, border:`1px solid ${i===0?c.accent+"44":c.border}`, borderRadius:14, overflow:"hidden", animation:`fu 0.35s ease ${i*0.08}s both` }}>
                      <img src={d.img} alt="" style={{ width:"100%", height:80, objectFit:"cover", display:"block" }} onError={e=>e.target.style.display="none"}/>
                      <div style={{ padding:"12px 14px", display:"flex", alignItems:"center", gap:12 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{d.place}</div>
                          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{d.address}</div>
                          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5 }}>
                            <div style={{ background:`${P.color}15`, border:`1px solid ${P.color}30`, borderRadius:6, padding:"2px 6px" }}>
                              <span style={{ fontSize:9, fontWeight:700, color:P.color, fontFamily:"'DM Sans',sans-serif" }}>{P.label}</span>
                            </div>
                            <Ico.Pin s={10} c={c.accent}/>
                            <span style={{ fontSize:10, color:c.accent, fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>{d.district}</span>
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>{d.items.length} item{d.items.length>1?"s":""}</div>
                          <div style={{ fontSize:16, fontWeight:800, color:c.accent, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>from QAR {Math.min(...d.items.map(it=>it.p)).toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ height:20 }}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST DETAIL
// ─────────────────────────────────────────────────────────────────────────────
function PostDetail({ deal, theme, lang, onBack, onPostHere }) {
  const [on, setOn] = useState(false);
  const c = TH[theme];
  const PM = PLATFORM_META[deal.platform] || PLATFORM_META.store;
  useEffect(()=>{ setTimeout(()=>setOn(true),60); },[]);
  const a = d => on?{animation:`fu .4s ease ${d}s both`}:{opacity:0};

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ flex:1, overflowY:"auto", padding:"8px 0 24px" }}>

        <div style={{ padding:"4px 20px 16px", display:"flex", alignItems:"center", gap:12, ...a(0.04) }}>
          <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <Avatar user={deal.user} size={28}/>
            <span style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{deal.user.username}</span>
            <span style={{ fontSize:9, fontWeight:700, color:RANK_COLORS[deal.user.rank], fontFamily:"'DM Sans',sans-serif" }}>{RANKS[deal.user.rank]?.label}</span>
          </div>
        </div>

        <div style={{ padding:"0 20px", ...a(0.08) }}>
          {/* Platform + location */}
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:3, background:`${PM.color}18`, border:`1px solid ${PM.color}44`, borderRadius:6, padding:"3px 8px" }}>
              <div style={{ width:5, height:5, borderRadius:"50%", background:PM.color }}/>
              <span style={{ fontSize:10, fontWeight:700, color:PM.color, fontFamily:"'DM Sans',sans-serif" }}>{PM.label}</span>
            </div>
            <Ico.Pin s={10} c={c.accent}/>
            <span style={{ fontSize:11, color:c.accent, fontWeight:600, fontFamily:"'DM Sans',sans-serif" }}>{deal.district}</span>
            <span style={{ fontSize:10, color:c.sub }}>· {deal.time} ago</span>
          </div>

          {/* Store name */}
          <div style={{ background:c.muted, borderRadius:10, padding:"8px 12px", marginBottom:12, display:"flex", alignItems:"center", gap:7 }}>
            <Ico.Pin s={12} c={c.sub}/>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{deal.place}</div>
              <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:1 }}>{deal.address}</div>
            </div>
          </div>

          {/* Full subject */}
          <p style={{ fontSize:15, fontWeight:500, color:c.text, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6, marginBottom:16 }}>{deal.subject}</p>

          {/* Prices */}
          <div style={{ background:c.muted, borderRadius:12, padding:"14px 14px", marginBottom:12 }}>
            {deal.items.map((item,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:i>0?10:0, marginTop:i>0?10:0, borderTop:i>0?`1px solid ${c.border}`:"none" }}>
                <span style={{ fontSize:14, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{item.n}</span>
                <span style={{ fontSize:16, fontWeight:800, color:c.accent, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>QAR {Number(item.p).toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Map */}
          <div style={{ borderRadius:14, overflow:"hidden", border:`1px solid ${c.border}`, position:"relative", height:130, marginBottom:12 }}>
            <svg width="100%" height="130" viewBox="0 0 335 130" preserveAspectRatio="xMidYMid slice">
              <rect width="335" height="130" fill={theme==="dark"?"#1A1810":"#E8E0CC"}/>
              {[0,1,2,3,4,5,6].map(i=><line key={`h${i}`} x1="0" y1={i*22} x2="335" y2={i*22} stroke={theme==="dark"?"#2A2010":"#D4C8A8"} strokeWidth="10"/>)}
              {[0,1,2,3,4,5,6,7,8,9].map(i=><line key={`v${i}`} x1={i*38} y1="0" x2={i*38} y2="130" stroke={theme==="dark"?"#2A2010":"#D4C8A8"} strokeWidth="10"/>)}
              {[[10,5,28,14],[50,5,28,14],[90,5,38,14],[140,5,50,14],[202,5,28,14],[242,5,45,14],[10,28,58,14],[80,28,40,14],[132,28,30,14],[174,28,48,14],[234,28,58,14],[10,51,30,14],[52,51,50,14],[114,51,28,14],[154,51,68,14],[234,51,70,14],[10,74,40,14],[62,74,58,14],[132,74,40,14],[184,74,60,14],[256,74,72,14],[10,97,80,14],[102,97,50,14],[164,97,60,14],[236,97,92,14]].map(([x,y,w,h],i)=>(
                <rect key={i} x={x} y={y} width={w} height={h} rx="2" fill={theme==="dark"?"#241C0C":"#C8BC98"} opacity="0.7"/>
              ))}
              <circle cx="167" cy="65" r="14" fill={TH[theme].accent} opacity="0.2"/>
              <circle cx="167" cy="65" r="8" fill={TH[theme].accent}/>
              <circle cx="167" cy="65" r="4" fill="#FFFFFF"/>
            </svg>
            <div style={{ position:"absolute", bottom:8, left:10, background:"rgba(0,0,0,0.65)", borderRadius:8, padding:"4px 10px" }}>
              <span style={{ fontSize:12, fontWeight:600, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif" }}>{deal.place}</span>
            </div>
            <button style={{ position:"absolute", top:8, right:10, background:TH[theme].accent, border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer" }}>
              <span style={{ fontSize:11, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif" }}>Open in Maps</span>
            </button>
          </div>

          {/* Stats */}
          <div style={{ display:"flex", gap:16, padding:"0 4px" }}>
            {[{label:"Ups",val:deal.ups},{label:"Revealed",val:deal.claims},{label:"Time",val:deal.time+" ago"}].map(s=>(
              <div key={s.label} style={{ textAlign:"center" }}>
                <div style={{ fontSize:16, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{s.val}</div>
                <div style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Post about same location */}
          <div style={{ marginTop:20 }}>
            <button onClick={()=>onPostHere(deal)} style={{ width:"100%", display:"flex", alignItems:"center", gap:12, background:c.surface, border:`1.5px solid ${c.border}`, borderRadius:16, padding:"16px 16px", cursor:"pointer", textAlign:"left", transition:"border-color 0.2s" }}
              onMouseOver={e=>e.currentTarget.style.borderColor=c.accent+"55"}
              onMouseOut={e=>e.currentTarget.style.borderColor=c.border}
            >
              <div style={{ width:38, height:38, borderRadius:10, background:`${c.accent}15`, border:`1px solid ${c.accent}30`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <Ico.Plus s={18} c={c.accent}/>
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>Found something different here?</div>
                <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>Post your own take about {deal.place.split(" ").slice(0,2).join(" ")}</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEV — POST REVIEW QUEUE
// ─────────────────────────────────────────────────────────────────────────────
function DevReview({ theme, pendingPosts, onApprove, onReject }) {
  const queue = pendingPosts || [];
  const [selected, setSelected]       = useState(null);
  const [busyId, setBusyId]           = useState(null); // disable while in-flight
  const [approvedCount, setApprovedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [on, setOn]                   = useState(false);
  const c = TH[theme];

  useEffect(()=>{ setTimeout(()=>setOn(true),60); },[]);

  const a = d => on?{animation:`fu .4s ease ${d}s both`}:{opacity:0};

  const approve = async (post) => {
    if (busyId) return;
    setBusyId(post.id);
    setSelected(null);
    try {
      await (onApprove ? onApprove(post) : Promise.resolve());
      setApprovedCount(v => v + 1);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (post) => {
    if (busyId) return;
    setBusyId(post.id);
    setSelected(null);
    try {
      await (onReject ? onReject(post) : Promise.resolve());
      setRejectedCount(v => v + 1);
    } finally {
      setBusyId(null);
    }
  };

  const PM = (key) => {
    const m = { talabat:{color:"#FF6B35",label:"Talabat"}, snoonu:{color:"#7C3AED",label:"Snoonu"}, careem:{color:"#16A34A",label:"Careem"}, rafeeq:{color:"#0284C7",label:"Rafeeq"}, store:{color:"#B8860B",label:"In Store"}, other:{color:"#888",label:"Other"} };
    return m[key]||m.other;
  };

  // Detail view
  if (selected) {
    const p = PM(selected.platform);
    return (
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ flex:1, overflowY:"auto", padding:"10px 0 24px" }}>
          <div style={{ padding:"4px 20px 14px", display:"flex", alignItems:"center", gap:12 }}>
            <button onClick={()=>setSelected(null)} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
            <div style={{ fontSize:14, fontWeight:700, color:"#1D6FEB", fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.04em" }}>DEV REVIEW</div>
          </div>

          <div style={{ padding:"0 20px" }}>
            <img src={selected.img} alt="" style={{ width:"100%", height:150, objectFit:"cover", borderRadius:14, marginBottom:14 }} onError={e=>e.target.style.display="none"}/>

            {/* User */}
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
              <Avatar user={selected.user} size={32}/>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{selected.user.username}</div>
                <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>Submitted {selected.submitted}</div>
              </div>
            </div>

            {/* Meta */}
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
              <div style={{ background:`${p.color}18`, border:`1px solid ${p.color}44`, borderRadius:8, padding:"4px 10px" }}>
                <span style={{ fontSize:11, fontWeight:700, color:p.color, fontFamily:"'DM Sans',sans-serif" }}>{p.label}</span>
              </div>
              <div style={{ background:c.muted, border:`1px solid ${c.border}`, borderRadius:8, padding:"4px 10px" }}>
                <span style={{ fontSize:11, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{selected.district}</span>
              </div>
              <div style={{ background:c.muted, border:`1px solid ${c.border}`, borderRadius:8, padding:"4px 10px" }}>
                <span style={{ fontSize:11, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{CATS.find(x=>x.key===selected.cat)?.label}</span>
              </div>
            </div>

            {/* Place */}
            <div style={{ background:c.muted, borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{selected.place}</div>
              <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{selected.address}</div>
            </div>

            {/* Subject */}
            <div style={{ fontSize:14, color:c.text, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6, marginBottom:14 }}>{selected.subject}</div>

            {/* Items */}
            <div style={{ background:c.muted, borderRadius:12, padding:"12px 14px", marginBottom:20 }}>
              <div style={{ fontSize:10, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8, fontFamily:"'DM Sans',sans-serif" }}>Submitted Prices</div>
              {selected.items.map((item,i)=>(
                <div key={i} style={{ display:"flex", justifyContent:"space-between", paddingTop:i>0?8:0, marginTop:i>0?8:0, borderTop:i>0?`1px solid ${c.border}`:"none" }}>
                  <span style={{ fontSize:13, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{item.n}</span>
                  <span style={{ fontSize:14, fontWeight:700, color:c.accent, fontFamily:"'DM Sans',sans-serif" }}>QAR {Number(item.p).toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Checklist */}
            <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:14, padding:"14px 14px", marginBottom:20 }}>
              <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10, fontFamily:"'DM Sans',sans-serif" }}>Review Checklist</div>
              {["Price is believable and specific","Location exists in Qatar","Take contains no numbers or prices","Platform source is correct","No spam or promotional content"].map((item,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10, paddingTop:i>0?8:0, marginTop:i>0?8:0, borderTop:i>0?`1px solid ${c.border}`:"none" }}>
                  <div style={{ width:16, height:16, borderRadius:4, border:`1.5px solid ${c.border}`, background:c.muted, flexShrink:0 }}/>
                  <span style={{ fontSize:12, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{item}</span>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>reject(selected)} style={{ flex:1, padding:"14px 0", background:"transparent", border:`2px solid ${c.border}`, borderRadius:14, fontSize:14, fontWeight:700, color:c.sub, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Reject</button>
              <button onClick={()=>approve(selected)} style={{ flex:2, padding:"14px 0", background:"#16A34A", border:"none", borderRadius:14, fontSize:14, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Approve & Publish</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Queue list
  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ flex:1, overflowY:"auto", padding:"10px 0 24px" }}>

        {/* Header */}
        <div style={{ padding:"4px 20px 16px", ...a(0.04) }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1D6FEB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            <span style={{ fontSize:16, fontWeight:700, color:"#1D6FEB", fontFamily:"'DM Sans',sans-serif" }}>BKM Dev Console</span>
          </div>
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>Post approval queue · {queue.length} pending</div>
        </div>

        {/* Stats row */}
        <div style={{ padding:"0 20px 16px", display:"flex", gap:10, ...a(0.07) }}>
          {[{label:"Pending",val:queue.length,col:"#F59E0B"},{label:"Approved",val:approvedCount,col:"#16A34A"},{label:"Rejected",val:rejectedCount,col:"#EF4444"}].map(s=>(
            <div key={s.label} style={{ flex:1, background:c.surface, border:`1px solid ${c.border}`, borderRadius:12, padding:"12px 0", textAlign:"center" }}>
              <div style={{ fontSize:22, fontWeight:800, color:s.col, fontFamily:"'DM Sans',sans-serif" }}>{s.val}</div>
              <div style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Pending queue */}
        {queue.length === 0 ? (
          <div style={{ textAlign:"center", padding:"40px 24px", ...a(0.1) }}>
            <div style={{ fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:6 }}>Queue is clear</div>
            <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>All posts have been reviewed.</div>
          </div>
        ) : (
          <div style={{ padding:"0 20px", display:"flex", flexDirection:"column", gap:10, ...a(0.1) }}>
            {queue.map((post,i)=>{
              const p = PM(post.platform);
              const safeUser = post.user || { id:"_", username:"User", av:"a1", founder:false, rank:0 };
              return (
                <button key={post.id} onClick={()=>setSelected(post)} style={{ background:post.founderPost?`#1D6FEB0A`:c.surface, border:`1px solid ${post.founderPost?"#1D6FEB44":c.border}`, borderRadius:16, overflow:"hidden", cursor:"pointer", textAlign:"left", transition:"border-color 0.15s", animation:`fu 0.35s ease ${i*0.07}s both` }}
                  onMouseOver={e=>e.currentTarget.style.borderColor=post.founderPost?"#1D6FEB88":"#1D6FEB55"}
                  onMouseOut={e=>e.currentTarget.style.borderColor=post.founderPost?"#1D6FEB44":c.border}
                >
                  {post.img ? <img src={post.img} alt="" style={{ width:"100%", height:80, objectFit:"cover", display:"block" }} onError={e=>e.target.style.display="none"}/> : null}
                  <div style={{ padding:"10px 12px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                      <Avatar user={safeUser} size={22}/>
                      <span style={{ fontSize:12, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{safeUser.username || "User"}</span>
                      <TierBadge user={safeUser} size="sm"/>
                      <span style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginLeft:"auto" }}>{post.submitted}</span>
                      <div style={{ background:`${p.color}18`, border:`1px solid ${p.color}44`, borderRadius:6, padding:"2px 6px" }}>
                        <span style={{ fontSize:9, fontWeight:700, color:p.color, fontFamily:"'DM Sans',sans-serif" }}>{p.label}</span>
                      </div>
                    </div>
                    <div style={{ fontSize:12, color:c.text, fontFamily:"'DM Sans',sans-serif", lineHeight:1.4, marginBottom:6 }}>{post.subject.slice(0,80)}...</div>
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={e=>{e.stopPropagation();reject(post);}} style={{ flex:1, padding:"7px 0", background:"transparent", border:`1px solid ${c.border}`, borderRadius:8, fontSize:11, fontWeight:600, color:c.sub, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Reject</button>
                      <button onClick={e=>{e.stopPropagation();approve(post);}} style={{ flex:2, padding:"7px 0", background:"#16A34A18", border:`1px solid #16A34A44`, borderRadius:8, fontSize:11, fontWeight:700, color:"#16A34A", fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Approve</button>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Approved log */}
        {approved.length > 0 && (
          <div style={{ padding:"16px 20px 0", ...a(0.14) }}>
            <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10, fontFamily:"'DM Sans',sans-serif" }}>Approved</div>
            {approved.map((post,i)=>(
              <div key={post.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:`1px solid ${c.border}` }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:"#16A34A", flexShrink:0 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{post.place}</div>
                  <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>by {post.user.username}</div>
                </div>
                <span style={{ fontSize:10, color:"#16A34A", fontWeight:700, fontFamily:"'DM Sans',sans-serif" }}>Live</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BETA CONSENT — TOS + Privacy Policy
// ─────────────────────────────────────────────────────────────────────────────
function BetaConsent({ theme, onAccept }) {
  const [scrolled, setScrolled] = useState(false);
  const [agreed, setAgreed]     = useState(false);
  const scrollRef               = useRef(null);
  const c = TH[theme];

  const onScroll = () => {
    const el = scrollRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setScrolled(true);
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", padding:"0 0 0 0" }}>
      {/* Header */}
      <div style={{ padding:"20px 24px 16px", flexShrink:0, borderBottom:`1px solid ${c.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
          <TagMark size={22} fill={c.accent} holeBg={c.bg}/>
          <span style={{ fontSize:18, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>BKM Beta</span>
          <span style={{ fontSize:10, fontWeight:700, color:"#F59E0B", background:"#F59E0B18", border:"1px solid #F59E0B44", borderRadius:6, padding:"2px 7px", fontFamily:"'DM Sans',sans-serif" }}>BETA</span>
        </div>
        <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.5 }}>Please read and accept our terms before joining. Scroll to the bottom to continue.</div>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} onScroll={onScroll} style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
        {[
          { title:"Beta Disclaimer", body:"BKM is currently in beta testing. The app may be unstable, features may change, and data may be reset without notice. By using BKM Beta you accept these conditions." },
          { title:"Price Accuracy", body:"All prices on BKM are submitted by community members and have not been independently verified. Prices may be outdated, incorrect, or no longer available. Always verify prices directly with the merchant before making a purchasing decision. BKM accepts no liability for pricing inaccuracies." },
          { title:"User Conduct", body:"You agree to post only prices you have personally seen or verified. You will not post false, misleading, offensive, or spam content. You will not impersonate other users, merchants, or BKM. Violations will result in immediate account suspension." },
          { title:"Privacy & Data", body:"BKM collects your phone number for authentication, your location to show nearby deals, and your interactions (reveals, votes, posts) to personalise your experience and provide analytics. Your data is processed by Google Firebase. We do not sell your data to third parties. You may request deletion of your account and data at any time by contacting us." },
          { title:"Content Rights", body:"By posting content on BKM you grant BKM a non-exclusive, royalty-free licence to display and distribute that content within the platform. You retain ownership of all content you post." },
          { title:"Governing Law", body:"These terms are governed by the laws of the State of Qatar. Any disputes shall be subject to the exclusive jurisdiction of Qatari courts." },
          { title:"Age Requirement", body:"You must be 18 years of age or older to use BKM. By continuing you confirm you meet this requirement." },
          { title:"Contact", body:"For privacy requests, content removal, or support: hello@bmk.qa" },
        ].map((s,i)=>(
          <div key={i} style={{ marginBottom:20 }}>
            <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:6 }}>{s.title}</div>
            <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.7 }}>{s.body}</div>
          </div>
        ))}
        <div style={{ height:8 }}/>
      </div>

      {/* Accept */}
      <div style={{ padding:"16px 24px 24px", flexShrink:0, borderTop:`1px solid ${c.border}`, background:c.bg }}>
        {/* Checkbox */}
        <button onClick={()=>scrolled&&setAgreed(a=>!a)} style={{ display:"flex", alignItems:"flex-start", gap:12, background:"none", border:"none", cursor:scrolled?"pointer":"default", textAlign:"left", marginBottom:16, opacity:scrolled?1:0.4, padding:0, width:"100%" }}>
          <div style={{ width:20, height:20, borderRadius:6, border:`2px solid ${agreed?c.accent:c.border}`, background:agreed?c.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1, transition:"all 0.15s" }}>
            {agreed && <Ico.Check s={12} c="#FFFFFF"/>}
          </div>
          <span style={{ fontSize:12, color:c.text, fontFamily:"'DM Sans',sans-serif", lineHeight:1.5 }}>
            I have read and agree to BKM's Terms of Service, Privacy Policy, and Beta Disclaimer. I am 18 years or older.
          </span>
        </button>
        {!scrolled && <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", textAlign:"center", marginBottom:10 }}>↓ Scroll to the bottom to enable acceptance</div>}
        <button onClick={()=>agreed&&onAccept()} style={{ width:"100%", padding:"15px 0", background:agreed?c.accent:c.muted, color:agreed?"#FFFFFF":c.sub, border:"none", borderRadius:14, fontSize:14, fontWeight:700, fontFamily:"'DM Sans',sans-serif", cursor:agreed?"pointer":"default", transition:"all 0.2s" }}>
          I Accept — Continue
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE SETUP — username + avatar
// ─────────────────────────────────────────────────────────────────────────────
// Unique avatar IDs — each maps to a unique color in palette
const AVATAR_IDS = ["a1","a2","a3","a4","a5","a6","a7","a8","a9","a10","a11","a12"];

function ProfileSetup({ theme, lang, onComplete }) {
  const [username, setUsername] = useState("");
  const [avatar, setAvatar]     = useState("a1");
  const [checking, setChecking] = useState(false);
  const [taken, setTaken]       = useState(false);
  const [error, setError]       = useState("");
  const [on, setOn]             = useState(false);
  const c = TH[theme];
  useEffect(()=>{setTimeout(()=>setOn(true),60);},[]);
  const a = d => on?{animation:`fu .45s ease ${d}s both`}:{opacity:0};

  const checkUsername = (val) => {
    setUsername(val);
    setTaken(false);
    setError("");
    if (!val) return;
    const err = isValidUsername(val);
    if (err) { setError(err); return; }
    // Simulate availability check
    setChecking(true);
    setTimeout(()=>{
      const isTaken = TAKEN_USERNAMES.includes(val.toLowerCase());
      setChecking(false);
      setTaken(isTaken);
      if (isTaken) setError("Username is already taken");
    }, 600);
  };

  const ready = username && !error && !taken && !checking;

  const handleComplete = () => {
    if (!ready) return;
    SESSION.username = username;
    SESSION.avatar   = avatar;
    SESSION.profileSetup = true;
    onComplete({ username, avatar });
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ flex:1, overflowY:"auto", padding:"24px 24px 32px" }}>

        <div style={{ ...a(0.04), marginBottom:24, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em", marginBottom:8 }}>Set up your profile</div>
          <div style={{ fontSize:13, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>This is how the community will know you</div>
        </div>

        {/* Avatar picker — colored initials, no duplicates, perfect circles */}
        <div style={{ ...a(0.08), marginBottom:24 }}>
          <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12, fontFamily:"'DM Sans',sans-serif" }}>Pick a color</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:10 }}>
            {AVATAR_PALETTE.map((col, idx) => {
              const id = `a${idx+1}`;
              const selected = avatar === id;
              const initial = initialFrom(username || "?");
              return (
                <button
                  key={id}
                  onClick={()=>setAvatar(id)}
                  style={{
                    aspectRatio:"1/1", borderRadius:"50%", padding:0,
                    background:col.bg,
                    border:`3px solid ${selected ? c.accent : "transparent"}`,
                    cursor:"pointer", transition:"all 0.18s cubic-bezier(0.34,1.56,0.64,1)",
                    boxShadow: selected ? `0 0 0 2px ${c.bg}, 0 0 0 4px ${c.accent}` : "none",
                    transform: selected ? "scale(1.08)" : "scale(1)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}
                >
                  <span style={{ fontSize:18, fontWeight:800, color:col.fg, fontFamily:"'DM Sans',sans-serif" }}>{initial}</span>
                </button>
              );
            })}
          </div>
          {/* Preview */}
          <div style={{ display:"flex", justifyContent:"center", marginTop:22 }}>
            {(() => {
              const idx = AVATAR_IDS.indexOf(avatar);
              const col = AVATAR_PALETTE[idx>=0?idx:0];
              return (
                <div style={{ width:78, height:78, borderRadius:"50%", background:col.bg, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:`0 8px 24px ${col.bg}55`, border:`3px solid ${c.bg}`, outline:`2px solid ${c.accent}` }}>
                  <span style={{ fontSize:34, fontWeight:800, color:col.fg, fontFamily:"'DM Sans',sans-serif" }}>{initialFrom(username||"?")}</span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Username */}
        <div style={a(0.12)}>
          <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8, fontFamily:"'DM Sans',sans-serif" }}>Choose a username</div>
          <div style={{ position:"relative" }}>
            <div style={{ position:"absolute", left:16, top:"50%", transform:"translateY(-50%)", fontSize:14, color:c.sub, fontFamily:"'DM Sans',sans-serif", pointerEvents:"none" }}>@</div>
            <input
              value={username}
              onChange={e=>checkUsername(e.target.value.replace(/\s/g,""))}
              placeholder="yourhandle"
              maxLength={20}
              style={{ ...inp(c), paddingLeft:30, borderColor: error?c.accent : username&&!error&&!checking?"#16A34A":c.inputBorder }}
              onFocus={e=>e.target.style.borderColor=c.accent}
              onBlur={e=>e.target.style.borderColor=error?c.accent:username&&!error&&!checking?"#16A34A":c.inputBorder}
            />
            {/* Status indicator */}
            <div style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)" }}>
              {checking && <div style={{ width:16, height:16, border:`2px solid ${c.border}`, borderTop:`2px solid ${c.accent}`, borderRadius:"50%", animation:"bkmSpin 0.7s linear infinite" }}/>}
              {!checking && username && !error && <Ico.Check s={16} c="#16A34A"/>}
            </div>
          </div>
          {/* Feedback */}
          {error && <div style={{ fontSize:11, color:c.accent, fontFamily:"'DM Sans',sans-serif", marginTop:6 }}>✕ {error}</div>}
          {!error && username && !checking && !taken && (
            <div style={{ fontSize:11, color:"#16A34A", fontFamily:"'DM Sans',sans-serif", marginTop:6 }}>✓ @{username} is available</div>
          )}
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:6 }}>3–20 characters · letters, numbers, underscores · no spaces</div>
        </div>

      </div>

      {/* Continue */}
      <div style={{ padding:"16px 24px 24px", flexShrink:0, borderTop:`1px solid ${c.border}`, background:c.bg }}>
        <button onClick={handleComplete} style={{ width:"100%", padding:"15px 0", background:ready?c.btnBg:c.muted, color:ready?c.btnText:c.sub, border:"none", borderRadius:14, fontSize:14, fontWeight:700, fontFamily:"'DM Sans',sans-serif", cursor:ready?"pointer":"default", transition:"all 0.2s" }}>
          {checking ? "Checking..." : ready ? "Set Up Profile" : "Complete all fields"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function NotificationsScreen({ notifications, theme, onBack, onMarkRead }) {
  const c = TH[theme];
  const renderIcon = (type, color) => {
    const props = { width:18, height:18, viewBox:"0 0 24 24", fill:"none", stroke:color, strokeWidth:2, strokeLinecap:"round", strokeLinejoin:"round" };
    switch(type) {
      case "reveal":  return <svg {...props}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
      case "upvote":  return <svg {...props} strokeWidth={2.4}><path d="M7 10v12"/><path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l4.41-7.41A2 2 0 0 1 13.07 2H14a2 2 0 0 1 2 2v1.88z"/></svg>;
      case "follow":  return <svg {...props}><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>;
      case "approve": return <svg {...props} strokeWidth={2.6}><polyline points="20 6 9 17 4 12"/></svg>;
      case "nearby":  return <svg {...props}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
      default:        return <svg {...props}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>;
    }
  };
  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ padding:"12px 20px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${c.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
          <span style={{ fontSize:17, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>Notifications</span>
        </div>
        <button onClick={onMarkRead} style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:c.accent, fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>Mark all read</button>
      </div>
      <div style={{ flex:1, overflowY:"auto" }}>
        {notifications.length === 0 ? (
          <div style={{ textAlign:"center", padding:"48px 24px", color:c.sub, fontFamily:"'DM Sans',sans-serif", fontSize:13 }}>No notifications yet</div>
        ) : notifications.map((n,i) => {
          const tone = n.read ? c.sub : c.accent;
          return (
            <div key={n.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 20px", borderBottom:`1px solid ${c.border}`, background:n.read?"transparent":`${c.accent}05`, animation:`fu 0.3s ease ${i*0.04}s both` }}>
              <div style={{ width:38, height:38, borderRadius:11, background:n.read?c.muted:`${c.accent}15`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {renderIcon(n.type, tone)}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, color:c.text, fontFamily:"'DM Sans',sans-serif", fontWeight:n.read?400:600, lineHeight:1.4 }}>{n.text}</div>
                <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:3 }}>{n.time} ago</div>
              </div>
              {!n.read && <div style={{ width:7, height:7, borderRadius:"50%", background:c.accent, flexShrink:0 }}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function SettingsScreen({ theme, themeMode, setThemeMode, lang, setLang, notifSettings, setNotifSettings, onBack, onSignOut }) {
  const [openFaq, setOpenFaq] = useState(null);
  const [soundOn, setSoundOn] = useState(SESSION.soundEnabled);
  const [supportModal, setSupportModal] = useState(null); // {title, mailto}
  const c = TH[theme];

  const isPWA = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator?.standalone);

  const openSupport = (subject, bodyHint) => {
    sfx.tap();
    const mailto = `mailto:hello@bkm.qa?subject=${encodeURIComponent(subject)}${bodyHint?`&body=${encodeURIComponent(bodyHint)}`:""}`;
    if (isPWA) {
      // PWA: show modal because mailto often fails silently
      try { navigator.clipboard?.writeText("hello@bkm.qa"); } catch(e){}
      setSupportModal({ title: subject, mailto });
    } else {
      // Browser: try mailto, also copy email as fallback
      try { navigator.clipboard?.writeText("hello@bkm.qa"); } catch(e){}
      window.location.href = mailto;
    }
  };

  const Toggle = ({ val, onToggle }) => (
    <button onClick={onToggle} style={{ width:44, height:26, borderRadius:13, background:val?c.accent:c.muted, border:"none", cursor:"pointer", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
      <div style={{ position:"absolute", top:3, left:val?20:3, width:20, height:20, borderRadius:"50%", background:"#FFFFFF", transition:"left 0.2s", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}/>
    </button>
  );

  const Row = ({ label, sub, right, onPress, border=true }) => (
    <button onClick={onPress||undefined} style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"14px 20px", background:"none", border:"none", borderBottom:border?`1px solid ${c.border}`:"none", cursor:onPress?"pointer":"default", textAlign:"left" }}>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:14, color:c.text, fontFamily:"'DM Sans',sans-serif", fontWeight:500 }}>{label}</div>
        {sub && <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{sub}</div>}
      </div>
      {right}
    </button>
  );

  const Section = ({ title }) => (
    <div style={{ padding:"20px 20px 8px" }}>
      <span style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase" }}>{title}</span>
    </div>
  );

  const FAQS = [
    { q:"How do reveals work?",              a:"You get 10 reveal energy. Each reveal uses 1. Energy refills 1 every 2 hours, or earn extras: post a deal (+3), get an upvote (+1), share a deal (+1, max 3/day), daily login (+5)." },
    { q:"How do I increase my rank?",        a:"Post verified deals that get upvoted and revealed. The higher your upvote-to-downvote ratio, the faster you climb from Scout to Elite." },
    { q:"What's a streak?",                  a:"A streak counts how many consecutive days you've revealed at least one deal. Skip a day and it resets. Visible on your profile." },
    { q:"Are prices verified?",              a:"All posts are reviewed by BKM before going live. We check that prices are believable and locations are real. Users can also report inaccurate prices." },
    { q:"Can I post in Arabic?",             a:"Yes. Arabic posts are fully supported. Your take can be in any language — the platform is built for Qatar." },
    { q:"How do I become a verified user?",  a:"Consistent accurate posts over time earn you the Verified badge. BKM reviews your posting history and grants it manually." },
    { q:"Is BKM free to use?",               a:"Yes. BKM is completely free for users. Merchants can list their prices for free. Premium features may come in future." },
  ];

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", position:"relative" }}>
      {/* Support modal — appears in PWA mode where mailto often fails */}
      {supportModal && (
        <div style={{ position:"absolute", inset:0, zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px" }}>
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(4px)" }} onClick={()=>setSupportModal(null)}/>
          <div style={{ position:"relative", zIndex:1, background:c.surface, borderRadius:20, padding:"24px 22px", textAlign:"center", animation:"scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both", width:"100%", maxWidth:360 }}>
            <div style={{ fontSize:18, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:6, letterSpacing:"-0.02em" }}>{supportModal.title}</div>
            <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.5, marginBottom:18 }}>
              We've copied <span style={{ fontWeight:700, color:c.accent }}>hello@bkm.qa</span> to your clipboard. Or tap below to open your mail app.
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setSupportModal(null)} style={{ flex:1, padding:"12px 0", background:"transparent", border:`1.5px solid ${c.border}`, borderRadius:12, fontSize:13, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Close</button>
              <a href={supportModal.mailto} onClick={()=>setTimeout(()=>setSupportModal(null), 200)} style={{ flex:1.4, padding:"12px 0", background:c.accent, border:"none", borderRadius:12, fontSize:13, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", cursor:"pointer", textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center" }}>Open Mail</a>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ padding:"12px 20px 14px", display:"flex", alignItems:"center", gap:10, borderBottom:`1px solid ${c.border}`, flexShrink:0 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
        <span style={{ fontSize:17, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>Settings</span>
      </div>

      <div style={{ flex:1, overflowY:"auto", paddingBottom:32 }}>

        {/* Notifications */}
        <Section title="Notifications"/>
        <div style={{ background:c.surface, borderTop:`1px solid ${c.border}`, borderBottom:`1px solid ${c.border}` }}>
          {[
            { key:"reveals", label:"Reveals",        sub:"When someone reveals your post" },
            { key:"upvotes", label:"Upvotes",         sub:"When someone upvotes your post" },
            { key:"follows", label:"New Followers",   sub:"When someone follows you" },
            { key:"nearby",  label:"Deals Near You",  sub:"New verified deals in your area" },
          ].map((item,i,arr) => (
            <Row key={item.key} label={item.label} sub={item.sub} border={i<arr.length-1}
              right={<Toggle val={notifSettings[item.key]} onToggle={()=>setNotifSettings(s=>({...s,[item.key]:!s[item.key]}))}/>}
            />
          ))}
        </div>

        {/* Sound */}
        <Section title="Sound"/>
        <div style={{ background:c.surface, borderTop:`1px solid ${c.border}`, borderBottom:`1px solid ${c.border}` }}>
          <Row
            label="Sound effects"
            sub="Reveal chimes, vote feedback, taps"
            right={<Toggle val={soundOn} onToggle={()=>{
              const next = !soundOn;
              setSoundOn(next);
              SESSION.soundEnabled = next;
              persistSession();
              if (next) sfx.success(); // demo on enable
            }}/>}
            border={false}
          />
        </div>

        {/* Appearance */}
        <Section title="Appearance"/>
        <div style={{ background:c.surface, borderTop:`1px solid ${c.border}`, borderBottom:`1px solid ${c.border}` }}>
          <div style={{ padding:"14px 20px", borderBottom:`1px solid ${c.border}` }}>
            <div style={{ fontSize:14, color:c.text, fontFamily:"'DM Sans',sans-serif", fontWeight:500, marginBottom:10 }}>Theme</div>
            <div style={{ display:"flex", gap:8 }}>
              {[{k:"dark",l:"Dark"},{k:"auto",l:"Auto"},{k:"light",l:"Light"}].map(t=>(
                <button key={t.k} onClick={()=>setThemeMode(t.k)} style={{ flex:1, padding:"10px 0", background:themeMode===t.k?c.accent:c.muted, border:"none", borderRadius:10, fontSize:13, fontWeight:700, color:themeMode===t.k?"#FFFFFF":c.sub, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", transition:"all 0.2s" }}>{t.l}</button>
              ))}
            </div>
          </div>
          <div style={{ padding:"14px 20px" }}>
            <div style={{ fontSize:14, color:c.text, fontFamily:"'DM Sans',sans-serif", fontWeight:500, marginBottom:10 }}>Language</div>
            <div style={{ display:"flex", gap:8 }}>
              {[{k:"en",l:"English"},{k:"ar",l:"العربية"}].map(l=>(
                <button key={l.k} onClick={()=>setLang(l.k)} style={{ flex:1, padding:"10px 0", background:lang===l.k?c.accent:c.muted, border:"none", borderRadius:10, fontSize:13, fontWeight:700, color:lang===l.k?"#FFFFFF":c.sub, fontFamily:"'DM Sans',sans-serif", cursor:"pointer", transition:"all 0.2s" }}>{l.l}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Support */}
        <Section title="Support"/>
        <div style={{ background:c.surface, borderTop:`1px solid ${c.border}`, borderBottom:`1px solid ${c.border}` }}>
          <Row label="Contact Us"     sub="hello@bkm.qa"    right={<span style={{ fontSize:12, color:c.sub }}>→</span>} onPress={()=>openSupport("BKM Support")}/>
          <Row label="Report a Bug"   sub="Help us improve" right={<span style={{ fontSize:12, color:c.sub }}>→</span>} onPress={()=>openSupport("BKM Bug Report", "What happened:\n\nWhat you expected:\n\nDevice: " + (typeof navigator !== "undefined" ? navigator.userAgent : "") + "\n")}/>
          <Row label="Request a Feature" sub="Tell us what you want" right={<span style={{ fontSize:12, color:c.sub }}>→</span>} onPress={()=>openSupport("BKM Feature Request", "I would love to see:\n\nWhy it matters:\n")} border={false}/>
        </div>

        {/* FAQs */}
        <Section title="FAQ"/>
        <div style={{ background:c.surface, borderTop:`1px solid ${c.border}`, borderBottom:`1px solid ${c.border}` }}>
          {FAQS.map((faq,i) => (
            <div key={i} style={{ borderBottom:i<FAQS.length-1?`1px solid ${c.border}`:"none" }}>
              <button onClick={()=>setOpenFaq(openFaq===i?null:i)} style={{ display:"flex", alignItems:"center", width:"100%", padding:"14px 20px", background:"none", border:"none", cursor:"pointer", textAlign:"left" }}>
                <span style={{ flex:1, fontSize:14, color:c.text, fontFamily:"'DM Sans',sans-serif", fontWeight:500 }}>{faq.q}</span>
                <span style={{ fontSize:16, color:c.sub, transition:"transform 0.2s", transform:openFaq===i?"rotate(90deg)":"none" }}>›</span>
              </button>
              {openFaq===i && (
                <div style={{ padding:"0 20px 14px", fontSize:13, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6, animation:"fu 0.2s ease both" }}>{faq.a}</div>
              )}
            </div>
          ))}
        </div>

        {/* About */}
        <Section title="About"/>
        <div style={{ background:c.surface, borderTop:`1px solid ${c.border}`, borderBottom:`1px solid ${c.border}` }}>
          <Row label="Terms of Service"  right={<span style={{ fontSize:12, color:c.sub }}>→</span>} onPress={()=>{}}/>
          <Row label="Privacy Policy"    right={<span style={{ fontSize:12, color:c.sub }}>→</span>} onPress={()=>{}}/>
          <Row label="Version" right={<span style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>Beta 0.1.0</span>} border={false}/>
        </div>

        {/* Sign out */}
        <div style={{ padding:"24px 20px 0" }}>
          <button onClick={onSignOut} style={{ width:"100%", padding:"14px 0", background:"transparent", border:`1.5px solid #EF444444`, borderRadius:14, fontSize:14, fontWeight:600, color:"#EF4444", fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>
            Sign Out
          </button>
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMUNITIES
// ─────────────────────────────────────────────────────────────────────────────

const COMMUNITY_BANNERS = [
  "#8B0038", "#1D6FEB", "#16A34A", "#C9892A", "#7C3AED",
  "#0EA5E9", "#DC2626", "#0891B2", "#EA580C", "#1C1208",
];
const COMMUNITY_CATEGORIES = [
  { key:"food",        label:"Food & Restaurants" },
  { key:"groceries",   label:"Groceries" },
  { key:"shopping",    label:"Shopping & Stores" },
  { key:"electronics", label:"Electronics & Tech" },
  { key:"flowers",     label:"Flowers & Gifts" },
  { key:"pharmacies",  label:"Pharmacies" },
  { key:"local",       label:"Local Tips" },
  { key:"deals",       label:"Daily Deals" },
  { key:"general",     label:"General" },
];

// Sub-card showing one community
function CommunityCard({ community, theme, isMember, onTap }) {
  const c = TH[theme];
  return (
    <button onClick={()=>onTap(community.id)} style={{
      width:"100%", display:"flex", alignItems:"center", gap:12,
      background:c.surface, border:`1px solid ${c.border}`, borderRadius:14,
      padding:"12px 14px", cursor:"pointer", textAlign:"left",
      transition:"border-color 0.15s",
    }}
      onMouseOver={e=>e.currentTarget.style.borderColor=c.accent+"55"}
      onMouseOut={e=>e.currentTarget.style.borderColor=c.border}
    >
      <div style={{ width:46, height:46, borderRadius:12, background:community.bannerColor||c.accent, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
        <span style={{ fontSize:20, fontWeight:800, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif" }}>
          {(community.name||"?").charAt(0).toUpperCase()}
        </span>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
          <span style={{ fontSize:14, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{community.name}</span>
          {community.verified && <span style={{ fontSize:9, fontWeight:800, color:c.accent, background:`${c.accent}15`, border:`1px solid ${c.accent}30`, borderRadius:5, padding:"1px 5px", fontFamily:"'DM Sans',sans-serif" }}>VERIFIED</span>}
          {isMember && <span style={{ fontSize:9, fontWeight:800, color:"#FFFFFF", background:c.accent, borderRadius:5, padding:"1px 5px", fontFamily:"'DM Sans',sans-serif" }}>JOINED</span>}
        </div>
        <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:3 }}>
          {community.description || "No description"}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>
            {community.memberCount||0} member{community.memberCount===1?"":"s"}
          </span>
          <span style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>
            · {community.postCount||0} posts
          </span>
        </div>
      </div>
      <span style={{ fontSize:14, color:c.sub, flexShrink:0 }}>›</span>
    </button>
  );
}

// Browse/main communities tab
function CommunitiesTab({ theme, lang, onOpenCommunity, onCreateCommunity }) {
  const [communities, setCommunities] = useState([]);
  const [myCommunities, setMyCommunities] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | mine | category-key
  const [search, setSearch] = useState("");
  const [on, setOn] = useState(false);
  const c = TH[theme];

  useEffect(()=>{ setTimeout(()=>setOn(true), 60); },[]);

  // Subscribe to all communities
  useEffect(() => {
    setLoading(true);
    const unsub = fbSubscribeCommunities((list) => {
      setCommunities(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Subscribe to user's own communities
  useEffect(() => {
    if (!fbAuth.currentUser) return;
    const unsub = fbSubscribeUserCommunities(fbAuth.currentUser.uid, (m) => setMyCommunities(m));
    return () => unsub();
  }, []);

  const a = d => on?{animation:`fu .4s ease ${d}s both`}:{opacity:0};

  const filtered = communities.filter(co => {
    if (filter === "mine") {
      if (!myCommunities.has(co.id)) return false;
    } else if (filter !== "all") {
      if (co.category !== filter) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      if (!co.name.toLowerCase().includes(q) && !(co.description||"").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"14px 20px 10px", borderBottom:`1px solid ${c.border}`, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
        <div style={{ ...a(0) }}>
          <div style={{ fontSize:20, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>Communities</div>
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:1 }}>Find your people in Doha</div>
        </div>
        <button onClick={()=>{ sfx.tap(); onCreateCommunity(); }} style={{ display:"flex", alignItems:"center", gap:5, background:c.accent, border:"none", borderRadius:11, padding:"9px 13px", cursor:"pointer", flexShrink:0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          <span style={{ fontSize:12, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif" }}>Create</span>
        </button>
      </div>

      {/* Search */}
      <div style={{ padding:"10px 16px 8px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:9, background:c.surface, border:`1.5px solid ${c.border}`, borderRadius:12, padding:"10px 14px" }}>
          <Ico.Search s={15} c={c.sub}/>
          <input
            value={search}
            onChange={e=>setSearch(e.target.value)}
            placeholder="Search communities..."
            style={{ flex:1, background:"none", border:"none", fontSize:15, color:c.text, fontFamily:"'DM Sans',sans-serif", outline:"none", minWidth:0 }}
          />
        </div>
      </div>

      {/* Filter pills */}
      <div style={{ padding:"4px 16px 12px", flexShrink:0, overflowX:"auto", display:"flex", gap:7 }}>
        {[
          { key:"all",  label:"All" },
          { key:"mine", label:`Joined${myCommunities.size>0?` (${myCommunities.size})`:""}` },
          ...COMMUNITY_CATEGORIES.slice(0, 7).map(cat => ({ key: cat.key, label: cat.label })),
        ].map(p => (
          <button key={p.key} onClick={()=>{ sfx.tap(); setFilter(p.key); }} style={{
            background: filter===p.key ? c.accent : "transparent",
            color: filter===p.key ? "#FFFFFF" : c.sub,
            border: filter===p.key ? "none" : `1px solid ${c.border}`,
            borderRadius:18, padding:"6px 13px",
            fontSize:11, fontWeight:600, fontFamily:"'DM Sans',sans-serif",
            cursor:"pointer", flexShrink:0, whiteSpace:"nowrap",
            transition:"all 0.15s",
          }}>{p.label}</button>
        ))}
      </div>

      {/* List */}
      <div style={{ flex:1, overflowY:"auto", padding:"4px 16px 24px" }}>
        {loading ? (
          <div style={{ textAlign:"center", padding:"60px 20px", color:c.sub, fontSize:13, fontFamily:"'DM Sans',sans-serif" }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:"center", padding:"40px 20px", color:c.sub, fontSize:13, fontFamily:"'DM Sans',sans-serif", lineHeight:1.6 }}>
            {filter === "mine" ? (
              <>You haven't joined any communities yet.<br/>Browse and tap one to join.</>
            ) : search ? (
              <>No communities match "{search}".</>
            ) : communities.length === 0 ? (
              <>
                No communities yet — be the first.<br/>
                <button onClick={onCreateCommunity} style={{ marginTop:14, background:c.accent, border:"none", borderRadius:11, padding:"10px 18px", color:"#FFFFFF", fontWeight:700, fontSize:13, fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>Create the first one</button>
              </>
            ) : (
              <>No communities in this category yet.</>
            )}
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10, ...a(0.05) }}>
            {filtered.map(co => (
              <CommunityCard key={co.id} community={co} theme={theme} isMember={myCommunities.has(co.id)} onTap={onOpenCommunity}/>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Single community detail screen
function CommunityDetail({ theme, lang, communityId, onBack, onPostInCommunity }) {
  const [community, setCommunity] = useState(null);
  const [members, setMembers] = useState([]);
  const [myMembership, setMyMembership] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [on, setOn] = useState(false);
  const c = TH[theme];

  useEffect(()=>{ setTimeout(()=>setOn(true), 60); },[]);

  useEffect(() => {
    const unsub = fbSubscribeCommunity(communityId, (co) => setCommunity(co));
    return () => unsub();
  }, [communityId]);

  useEffect(() => {
    const unsub = fbSubscribeCommunityMembers(communityId, (list) => {
      setMembers(list);
      if (fbAuth.currentUser) {
        const me = list.find(m => m.id === fbAuth.currentUser.uid);
        setMyMembership(me || null);
      }
    });
    return () => unsub();
  }, [communityId]);

  const handleJoin = async () => {
    if (!fbAuth.currentUser) return;
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fbJoinCommunity(communityId, fbAuth.currentUser.uid);
      sfx.success();
    } catch (e) {
      setError(e.message || "Couldn't join.");
      sfx.error();
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!fbAuth.currentUser) return;
    if (busy) return;
    if (!confirm("Leave this community?")) return;
    setBusy(true);
    setError("");
    try {
      await fbLeaveCommunity(communityId, fbAuth.currentUser.uid);
      sfx.voteDown();
    } catch (e) {
      setError(e.message || "Couldn't leave.");
      sfx.error();
    } finally {
      setBusy(false);
    }
  };

  const a = d => on?{animation:`fu .4s ease ${d}s both`}:{opacity:0};

  if (!community) {
    return (
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ padding:"12px 20px 14px", display:"flex", alignItems:"center", gap:10, borderBottom:`1px solid ${c.border}` }}>
          <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
        </div>
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:c.sub, fontSize:13, fontFamily:"'DM Sans',sans-serif" }}>Loading...</div>
      </div>
    );
  }

  const isOwner   = myMembership?.role === "owner";
  const isMod     = myMembership?.role === "mod" || isOwner;
  const isMember  = !!myMembership && !myMembership.banned;
  const isBanned  = myMembership?.banned;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"12px 20px 14px", display:"flex", alignItems:"center", gap:10, borderBottom:`1px solid ${c.border}`, flexShrink:0 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
        <span style={{ fontSize:15, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{community.name}</span>
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>
        {/* Banner */}
        <div style={{ height:90, background:`linear-gradient(135deg, ${community.bannerColor || c.accent}, ${community.bannerColor || c.accent}cc)`, position:"relative", ...a(0) }}/>

        {/* Header info */}
        <div style={{ padding:"14px 20px 18px", borderBottom:`1px solid ${c.border}`, ...a(0.05) }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:14, marginTop:-32, marginBottom:14 }}>
            <div style={{ width:64, height:64, borderRadius:16, background:community.bannerColor || c.accent, border:`4px solid ${c.bg}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ fontSize:28, fontWeight:800, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif" }}>
                {community.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div style={{ flex:1, paddingTop:34 }}>
              {isMember ? (
                <button onClick={handleLeave} disabled={busy || isOwner} style={{ background:"transparent", color:c.sub, border:`1.5px solid ${c.border}`, borderRadius:11, padding:"8px 16px", fontSize:12, fontWeight:700, fontFamily:"'DM Sans',sans-serif", cursor: busy||isOwner ? "default" : "pointer", opacity: busy||isOwner ? 0.5 : 1 }}>
                  {isOwner ? "Owner" : "Joined ✓"}
                </button>
              ) : isBanned ? (
                <button disabled style={{ background:"transparent", color:"#DC2626", border:"1.5px solid #DC262655", borderRadius:11, padding:"8px 16px", fontSize:12, fontWeight:700, fontFamily:"'DM Sans',sans-serif", opacity:0.7 }}>
                  Banned
                </button>
              ) : (
                <button onClick={handleJoin} disabled={busy} style={{ background:c.accent, color:"#FFFFFF", border:"none", borderRadius:11, padding:"8px 18px", fontSize:12, fontWeight:700, fontFamily:"'DM Sans',sans-serif", cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
                  {busy ? "..." : "Join"}
                </button>
              )}
            </div>
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:5 }}>
            <span style={{ fontSize:18, fontWeight:800, color:c.text, fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>{community.name}</span>
            {community.verified && <span style={{ fontSize:9, fontWeight:800, color:c.accent, background:`${c.accent}15`, border:`1px solid ${c.accent}30`, borderRadius:5, padding:"1px 6px", fontFamily:"'DM Sans',sans-serif" }}>VERIFIED</span>}
          </div>
          <div style={{ display:"flex", gap:14, marginBottom:10 }}>
            <span style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>
              <span style={{ color:c.text, fontWeight:700 }}>{community.memberCount||0}</span> {community.memberCount===1?"member":"members"}
            </span>
            <span style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>
              <span style={{ color:c.text, fontWeight:700 }}>{community.postCount||0}</span> posts
            </span>
            <span style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", textTransform:"capitalize" }}>
              {community.type || "public"}
            </span>
          </div>
          {community.description && (
            <div style={{ fontSize:13, color:c.text, fontFamily:"'DM Sans',sans-serif", lineHeight:1.5, marginBottom:6 }}>
              {community.description}
            </div>
          )}
          <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>
            Created by <span style={{ color:c.text, fontWeight:600 }}>@{community.ownerUsername || "owner"}</span>
          </div>
          {error && <div style={{ marginTop:8, fontSize:11, color:c.accent, fontFamily:"'DM Sans',sans-serif" }}>{error}</div>}
        </div>

        {/* Action row when joined */}
        {isMember && !isOwner && (
          <div style={{ padding:"16px 20px 0", ...a(0.1) }}>
            <button onClick={()=>onPostInCommunity && onPostInCommunity(community)} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:8, background:c.accent, border:"none", borderRadius:13, padding:"12px 0", fontSize:13, fontWeight:700, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", cursor:"pointer" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Post in this community
            </button>
          </div>
        )}

        {/* Owner / mod section */}
        {isMod && (
          <div style={{ padding:"16px 20px 0", ...a(0.12) }}>
            <div style={{ background:`${c.accent}08`, border:`1px dashed ${c.accent}55`, borderRadius:12, padding:"12px 14px" }}>
              <div style={{ fontSize:11, fontWeight:800, color:c.accent, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8, fontFamily:"'DM Sans',sans-serif" }}>{isOwner?"Owner Tools":"Mod Tools"}</div>
              <div style={{ fontSize:12, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.5 }}>
                Member management, post moderation, and community settings coming next session.
              </div>
            </div>
          </div>
        )}

        {/* Posts placeholder — coming next session */}
        <div style={{ padding:"24px 20px", ...a(0.16) }}>
          <div style={{ fontSize:11, fontWeight:800, color:c.sub, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10, fontFamily:"'DM Sans',sans-serif" }}>Community Feed</div>
          <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:14, padding:"30px 16px", textAlign:"center" }}>
            <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif", marginBottom:5 }}>Posts coming soon</div>
            <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", lineHeight:1.5 }}>
              Post-to-community is being wired up.<br/>Members will see a feed of community-only posts here.
            </div>
          </div>
        </div>

        <div style={{ height:24 }}/>
      </div>
    </div>
  );
}

// Create community form
function CreateCommunity({ theme, lang, onBack, onCreated }) {
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory]       = useState("general");
  const [type, setType]               = useState("public");
  const [bannerColor, setBannerColor] = useState(COMMUNITY_BANNERS[0]);
  const [nameStatus, setNameStatus]   = useState("idle"); // idle | checking | available | taken | invalid
  const [error, setError]             = useState("");
  const [busy, setBusy]               = useState(false);
  const [on, setOn]                   = useState(false);
  const checkRef = useRef(null);
  const c = TH[theme];

  useEffect(()=>{ setTimeout(()=>setOn(true), 60); },[]);

  // Debounced name uniqueness check
  useEffect(() => {
    if (checkRef.current) clearTimeout(checkRef.current);
    if (!name.trim()) { setNameStatus("idle"); return; }
    if (name.trim().length < 3) { setNameStatus("invalid"); return; }
    if (!/^[a-zA-Z0-9 _-]+$/.test(name.trim())) { setNameStatus("invalid"); return; }
    setNameStatus("checking");
    checkRef.current = setTimeout(async () => {
      try {
        const ok = await fbCheckCommunityNameAvailable(name.trim());
        setNameStatus(ok ? "available" : "taken");
      } catch (e) { setNameStatus("idle"); }
    }, 500);
    return () => clearTimeout(checkRef.current);
  }, [name]);

  const ready = name.trim().length >= 3 && nameStatus === "available" && !busy;

  const handleCreate = async () => {
    if (!ready || !fbAuth.currentUser) return;
    setBusy(true);
    setError("");
    try {
      const meDoc = await fbGetUserDoc(fbAuth.currentUser.uid);
      const cid = await fbCreateCommunity(
        { name: name.trim(), description: description.trim(), category, type, bannerColor },
        fbAuth.currentUser.uid,
        meDoc?.username || "user",
        meDoc?.avatar || "a1",
      );
      sfx.success();
      onCreated && onCreated(cid);
    } catch (e) {
      setError("Couldn't create community. Try again.");
      sfx.error();
      setBusy(false);
    }
  };

  const a = d => on?{animation:`fu .4s ease ${d}s both`}:{opacity:0};

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"12px 20px 14px", display:"flex", alignItems:"center", gap:10, borderBottom:`1px solid ${c.border}`, flexShrink:0 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 4px 4px 0" }}><Ico.Back s={18} c={c.sub}/></button>
        <span style={{ fontSize:17, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>Create Community</span>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"18px 20px 24px", display:"flex", flexDirection:"column", gap:16 }}>
        {/* Banner preview */}
        <div style={{ ...a(0) }}>
          <div style={{ height:80, borderRadius:14, background:`linear-gradient(135deg, ${bannerColor}, ${bannerColor}cc)`, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span style={{ fontSize:32, fontWeight:800, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.02em" }}>
              {(name || "?").charAt(0).toUpperCase()}
            </span>
          </div>
        </div>

        {/* Banner color picker */}
        <div style={{ ...a(0.04) }}>
          <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:7, fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>Banner color</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {COMMUNITY_BANNERS.map(col => (
              <button key={col} onClick={()=>{ sfx.tap(); setBannerColor(col); }} style={{
                width:34, height:34, borderRadius:10, background:col,
                border: bannerColor===col ? `3px solid ${c.text}` : `2px solid ${c.border}`,
                cursor:"pointer", padding:0,
              }}/>
            ))}
          </div>
        </div>

        {/* Name */}
        <div style={{ ...a(0.08) }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
            <span style={{ fontSize:11, color:c.sub, letterSpacing:"0.06em", textTransform:"uppercase", fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>Community name *</span>
            {nameStatus === "checking" && <span style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif" }}>Checking...</span>}
            {nameStatus === "available" && <span style={{ fontSize:10, color:"#16A34A", fontWeight:700, fontFamily:"'DM Sans',sans-serif" }}>✓ Available</span>}
            {nameStatus === "taken" && <span style={{ fontSize:10, color:c.accent, fontWeight:700, fontFamily:"'DM Sans',sans-serif" }}>✕ Taken</span>}
            {nameStatus === "invalid" && <span style={{ fontSize:10, color:c.accent, fontWeight:700, fontFamily:"'DM Sans',sans-serif" }}>3+ chars · letters/numbers only</span>}
          </div>
          <input
            value={name}
            onChange={e=>setName(e.target.value.slice(0, 30))}
            placeholder="e.g. Qatar Burgers"
            style={{ ...inp(c), borderColor: nameStatus==="taken"||nameStatus==="invalid" ? c.accent : c.inputBorder }}
          />
        </div>

        {/* Description */}
        <div style={{ ...a(0.12) }}>
          <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:7, fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>What's it about? <span style={{ textTransform:"none", letterSpacing:0, color:c.sub, fontWeight:400 }}>· optional</span></div>
          <textarea
            value={description}
            onChange={e=>setDescription(e.target.value.slice(0, 200))}
            placeholder="A community for finding the best burger spots in Qatar..."
            rows={3}
            style={{ ...inp(c), resize:"vertical", minHeight:70, lineHeight:1.5 }}
          />
          <div style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:4, textAlign:"right" }}>{description.length}/200</div>
        </div>

        {/* Category */}
        <div style={{ ...a(0.16) }}>
          <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:7, fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>Category</div>
          <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
            {COMMUNITY_CATEGORIES.map(cat => (
              <button key={cat.key} onClick={()=>{ sfx.tap(); setCategory(cat.key); }} style={{
                background: category===cat.key ? c.accent : "transparent",
                color: category===cat.key ? "#FFFFFF" : c.sub,
                border: category===cat.key ? "none" : `1px solid ${c.border}`,
                borderRadius:18, padding:"7px 14px",
                fontSize:11, fontWeight:600, fontFamily:"'DM Sans',sans-serif",
                cursor:"pointer", transition:"all 0.15s",
              }}>{cat.label}</button>
            ))}
          </div>
        </div>

        {/* Type */}
        <div style={{ ...a(0.20) }}>
          <div style={{ fontSize:11, color:c.sub, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:7, fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>Privacy</div>
          <div style={{ display:"flex", gap:8 }}>
            {[
              { key:"public",  label:"Public",  sub:"Anyone can join and post" },
              { key:"private", label:"Private", sub:"You approve members" },
            ].map(opt => (
              <button key={opt.key} onClick={()=>{ sfx.tap(); setType(opt.key); }} style={{
                flex:1, textAlign:"left",
                background: type===opt.key ? `${c.accent}10` : c.surface,
                border: type===opt.key ? `1.5px solid ${c.accent}` : `1.5px solid ${c.border}`,
                borderRadius:12, padding:"11px 13px",
                cursor:"pointer", transition:"all 0.15s",
              }}>
                <div style={{ fontSize:13, fontWeight:700, color:c.text, fontFamily:"'DM Sans',sans-serif" }}>{opt.label}</div>
                <div style={{ fontSize:11, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>{opt.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {error && <div style={{ ...a(0.24), fontSize:12, color:c.accent, fontFamily:"'DM Sans',sans-serif" }}>{error}</div>}

        {/* Submit */}
        <div style={{ ...a(0.26), marginTop:8 }}>
          <button onClick={handleCreate} disabled={!ready} style={{
            width:"100%", padding:"13px 0",
            background: ready ? c.accent : c.muted,
            color: ready ? "#FFFFFF" : c.sub,
            border:"none", borderRadius:13,
            fontSize:14, fontWeight:700, fontFamily:"'DM Sans',sans-serif",
            cursor: ready ? "pointer" : "default",
            transition:"all 0.15s",
          }}>
            {busy ? "Creating..." : "Create Community"}
          </button>
          <div style={{ fontSize:10, color:c.sub, fontFamily:"'DM Sans',sans-serif", marginTop:8, textAlign:"center", lineHeight:1.5 }}>
            You'll be the owner. You can manage posts and members.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP SHELL
// ─────────────────────────────────────────────────────────────────────────────
export default function BKMApp() {
  const [screen, setScreen]         = useState(SESSION.loggedIn ? "feed" : "opening");
  const [themeMode, setThemeMode]   = useState("auto");
  const [lang, setLang]             = useState("en");
  const [tab, setTab]               = useState("feed");
  const [fading, setFading]         = useState(false);
  const [pushedScreen, setPushed]   = useState(null);
  const [feedDeals, setFeedDeals]   = useState([]);                 // populated from Firestore
  const [pendingPosts, setPending]  = useState([]);                 // populated from Firestore (admin-only)
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedQuery, setFeedQuery]   = useState("");
  const [postPrefill, setPostPrefill] = useState(null);
  const [partnerOrigin, setPartnerOrigin] = useState(null);
  const [isAdmin, setIsAdmin]       = useState(SESSION.isAdmin);
  const [newPostId, setNewPostId]   = useState(200);
  const [authReady, setAuthReady]   = useState(false);
  const [fbUser, setFbUser]         = useState(null);
  const [activeCommunityId, setActiveCommunityId] = useState(null);

  // === Firebase auth state listener — keeps UI in sync with auth ===
  const initialAuthRouted = useRef(false);
  useEffect(() => {
    const unsub = onAuthStateChanged(fbAuth, async (user) => {
      if (!user) {
        // Signed out
        setFbUser(null);
        SESSION.loggedIn = false;
        SESSION.isAdmin = false;
        SESSION.isFounder = false;
        SESSION.isMerchant = false;
        CURRENT_USER = null;
        setIsAdmin(false);
        setAuthReady(true);
        if (!initialAuthRouted.current) initialAuthRouted.current = true;
        return;
      }
      setFbUser(user);

      // Hydrate from Firestore user doc
      let userDoc = await fbGetUserDoc(user.uid);
      if (!userDoc) {
        // First-time user — create blank doc
        await fbCreateUserDoc(user.uid, { phone: user.phoneNumber || "" });
        userDoc = await fbGetUserDoc(user.uid);
      }
      if (!userDoc) userDoc = {};

      // Mirror to SESSION + CURRENT_USER cache
      SESSION.loggedIn         = true;
      SESSION.isAdmin          = !!userDoc.isAdmin;
      SESSION.isFounder        = !!userDoc.isFounder;
      SESSION.isMerchant       = !!userDoc.isMerchant;
      SESSION.merchantName     = userDoc.merchantName || "";
      SESSION.merchantCategory = userDoc.merchantCategory || "";
      SESSION.tosAccepted      = !!userDoc.tosAccepted;
      SESSION.profileSetup     = !!userDoc.profileSetup;
      SESSION.username         = userDoc.username || "";
      SESSION.avatar           = userDoc.avatar || "a1";
      SESSION.interests        = userDoc.interests || [];
      SESSION.tutorialSeen     = !!userDoc.tutorialSeen;
      SESSION.revealEnergy     = userDoc.revealEnergy ?? MAX_ENERGY;
      SESSION.lastEnergyUpdate = userDoc.lastEnergyUpdate || Date.now();
      SESSION.sharesUsedToday  = userDoc.sharesUsedToday || 0;
      SESSION.shareDateKey     = userDoc.shareDateKey || "";
      SESSION.lastDailyBonusDate = userDoc.lastDailyBonusDate || "";
      SESSION.lastRevealDate   = userDoc.lastRevealDate || "";
      SESSION.streak           = userDoc.streak || 0;
      SESSION.bestStreak       = userDoc.bestStreak || 0;
      SESSION.soundEnabled     = userDoc.soundEnabled !== false;
      CURRENT_USER = {
        id: user.uid,
        uid: user.uid,
        username: userDoc.username || "",
        av: userDoc.avatar || "a1",
        rank: userDoc.rank || 0,
        founder: !!userDoc.isFounder,
        followers: userDoc.followers || 0,
        deals: 0,
      };
      setIsAdmin(!!userDoc.isAdmin);
      setAuthReady(true);

      // Auto-route on first auth resolution: skip the opening screen if user is logged in
      if (!initialAuthRouted.current) {
        initialAuthRouted.current = true;
        if (userDoc.profileSetup && userDoc.tosAccepted) {
          setScreen("feed");
        } else if (userDoc.tosAccepted) {
          setScreen("profile");
        } else {
          setScreen("consent");
        }
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to approved deals (the live feed)
  useEffect(() => {
    setFeedLoading(true);
    const unsub = fbSubscribeApprovedDeals((deals) => {
      // Map Firestore docs into the shape DealCard expects
      const mapped = deals.map(d => ({
        id: d.id,
        subject: d.subject,
        user: { id: d.userId, username: d.userUsername, av: d.userAvatar, founder: d.userFounder, rank: d.userRank || 0 },
        cat: d.cat, platform: d.platform, district: d.district, place: d.place,
        address: d.address || d.district, items: d.items || [],
        claims: d.claims || 0, ups: d.ups || 0, downs: d.downs || 0,
        verified: !!d.verified,
        submitted: d.submittedAt || "Recently",
        img: d.img || null,
      }));
      setFeedDeals(mapped);
      setFeedLoading(false);
    });
    return () => unsub();
  }, []);

  // Subscribe to pending deals (admin-only review queue)
  useEffect(() => {
    if (!isAdmin) { setPending([]); return; }
    const unsub = fbSubscribePendingDeals((posts) => {
      const mapped = posts.map(p => ({
        id: p.id,
        subject: p.subject,
        user: { id: p.userId, username: p.userUsername, av: p.userAvatar, founder: p.userFounder, rank: p.userRank || 0 },
        cat: p.cat, platform: p.platform, district: p.district, place: p.place,
        address: p.address || p.district, items: p.items || [],
        founderPost: !!p.userFounder,
        submitted: p.submittedAt || "Just now",
        img: p.img || null,
      }));
      setPending(mapped);
    });
    return () => unsub();
  }, [isAdmin]);

  const theme = themeMode==="auto" ? getAuto() : themeMode;
  const c = TH[theme];

  const go      = (s) => { setFading(true); setTimeout(()=>{ setScreen(s); setFading(false); },160); };
  const push    = (type, data) => setPushed({ type, data });
  const pop     = () => setPushed(null);
  const signOut = async () => {
    try { await fbDoSignOut(); } catch(e) {}
    SESSION.loggedIn = false;
    SESSION.isAdmin  = false;
    SESSION.isFounder = false;
    SESSION.isMerchant = false;
    SESSION.merchantName = "";
    SESSION.merchantCategory = "";
    SESSION.tosAccepted = false;
    SESSION.profileSetup = false;
    SESSION.username = "";
    SESSION.interests = [];
    SESSION.following = new Set();
    SESSION.claimed = new Set();
    SESSION.tutorialSeen = false;
    SESSION.locPerm = "pending";
    SESSION.hasLoc = "";
    CURRENT_USER = null;
    setIsAdmin(false);
    setPushed(null);
    setTab("feed");
    setPartnerOrigin(null);
    initialAuthRouted.current = false; // allow re-routing on next signin
    go("opening");
  };

  const [notifications, setNotifications] = useState([
    { id:1, type:"reveal", text:"DealHunterQ revealed your shawarma post", time:"2m", read:false },
    { id:2, type:"upvote", text:"PearlFinds upvoted your shawarma post",   time:"5m", read:false },
    { id:3, type:"reveal", text:"DohaDeals_ revealed your shawarma post",  time:"12m",read:true  },
  ]);
  const [toasts, setToasts]             = useState([]);
  const [notifSettings, setNotifSettings] = useState({ reveals:true, upvotes:true, follows:true, nearby:false });
  const unreadCount = notifications.filter(n=>!n.read).length;

  const addToast = (msg, type="reveal") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x=>x.id!==id)), 3200);
    setNotifications(n => [{ id, type, text:msg, time:"now", read:false }, ...n]);
  };

  const markAllRead = () => setNotifications(n => n.map(x=>({...x,read:true})));

  const handleNewPost = async (postData) => {
    const me = getMe();
    if (!fbAuth.currentUser) {
      addToast("You must be signed in to post", "approve");
      return;
    }
    try {
      await fbSubmitPost({
        subject: postData.subject,
        cat: postData.cat,
        platform: postData.platform,
        district: postData.district,
        place: postData.place,
        address: postData.address || postData.district,
        items: postData.items || [],
        img: null,
      }, {
        uid: fbAuth.currentUser.uid,
        username: me.username,
        avatar: me.av || SESSION.avatar || "a1",
        isFounder: !!me.founder,
        rank: me.rank || 0,
      });
      // Reward user with +3 energy for posting + success sound
      earnReveals(3);
      if (fbAuth.currentUser) fbUpdateUserDoc(fbAuth.currentUser.uid, { revealEnergy: SESSION.revealEnergy }).catch(()=>{});
      sfx.success();
      setTimeout(() => sfx.earn(), 400);
      addToast("+3 reveals · Posted! Awaiting BKM review.", "approve");
    } catch (e) {
      sfx.error();
      addToast("Couldn't submit post — try again", "approve");
    }
  };

  // Called by DevReview on approve
  const handleApprove = async (post) => {
    if (!fbAuth.currentUser) return;
    try {
      await fbApprovePost(post.id, fbAuth.currentUser.uid);
      // Live feed will update via subscription. No need to mutate local state.
      if (post.user?.id === getMe().id) addToast("Your post is live on the feed!", "approve");
    } catch (e) {
      addToast("Approve failed — try again", "approve");
    }
  };

  const handleReject = async (post) => {
    if (!fbAuth.currentUser) return;
    try {
      await fbRejectPost(post.id, fbAuth.currentUser.uid);
      // Subscription will remove from queue automatically.
    } catch (e) {
      addToast("Reject failed — try again", "approve");
    }
  };

  const showTabs = screen==="feed";

  const renderTab = () => {
    if (pushedScreen?.type==="location")      return <LocationPage district={pushedScreen.data} theme={theme} lang={lang} onBack={pop} onUserTap={u=>push("user",u)}/>;
    if (pushedScreen?.type==="user")          return <Profile user={pushedScreen.data} theme={theme} lang={lang} onBack={pop} showBack/>;
    if (pushedScreen?.type==="post")          return <PostDetail deal={pushedScreen.data} theme={theme} lang={lang} onBack={pop} onPostHere={d=>{ pop(); setTab("post"); setPostPrefill(d); }}/>;
    if (pushedScreen?.type==="notifications") return <NotificationsScreen notifications={notifications} theme={theme} onBack={pop} onMarkRead={markAllRead}/>;
    if (pushedScreen?.type==="settings")      return <SettingsScreen theme={theme} themeMode={themeMode} setThemeMode={setThemeMode} lang={lang} setLang={setLang} notifSettings={notifSettings} setNotifSettings={setNotifSettings} onBack={pop} onSignOut={signOut}/>;
    if (pushedScreen?.type==="following")     return <FollowingList theme={theme} lang={lang} onBack={pop} onUserTap={u=>{ pop(); push("user",u); }}/>;
    if (tab==="feed")    return <Feed       theme={theme} lang={lang} deals={feedDeals} onUserTap={u=>push("user",u)} onLocationTap={d=>push("location",d)} onSearch={q=>{ setFeedQuery(q); setPushed(null); setTab("search"); }} onOpenPost={d=>push("post",d)} onReveal={(msg)=>notifSettings.reveals&&addToast(msg,"reveal")} onUpvote={(msg)=>notifSettings.upvotes&&addToast(msg,"upvote")} onPartnerRequest={()=>{ setPartnerOrigin("feed"); go("partner"); }} onPostBetter={(deal)=>{ setPushed(null); setPostPrefill(deal); setTab("post"); }}/>;
    if (tab==="search")  return <SearchTab  theme={theme} lang={lang} onLocationTap={d=>push("location",d)} initialQuery={feedQuery}/>;
    if (tab==="communities") return <ErrorBoundary><CommunitiesTab theme={theme} lang={lang} onOpenCommunity={(cid)=>{ setActiveCommunityId(cid); go("community"); }} onCreateCommunity={()=>go("createCommunity")}/></ErrorBoundary>;
    if (tab==="post")    return <PostDeal   theme={theme} lang={lang} onBack={()=>setTab("feed")} prefill={postPrefill} onClearPrefill={()=>setPostPrefill(null)} onSubmit={handleNewPost}/>;
    if (tab==="profile") return <Profile    user={getMe()} theme={theme} lang={lang} onSignOut={signOut} onNotifications={()=>push("notifications",null)} onSettings={()=>push("settings",null)} unreadCount={unreadCount} onViewFollowing={()=>push("following",null)}/>;
    if (tab==="dev")     return <ErrorBoundary><DevReview  theme={theme} pendingPosts={pendingPosts} onApprove={handleApprove} onReject={handleReject}/></ErrorBoundary>;
  };

  // Inject PWA meta tags + force body bg to match theme so safe-area isn't black
  useEffect(() => {
    const metas = [
      { name:"viewport", content:"width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover" },
      { name:"theme-color", content: c.bg },
      { name:"apple-mobile-web-app-capable", content:"yes" },
      { name:"mobile-web-app-capable", content:"yes" },
      { name:"apple-mobile-web-app-status-bar-style", content:"default" },
      { name:"apple-mobile-web-app-title", content:"BKM" },
    ];
    metas.forEach(m => {
      let el = document.querySelector(`meta[name="${m.name}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute("name", m.name); document.head.appendChild(el); }
      el.setAttribute("content", m.content);
    });
    document.title = "BKM — بكم";
    // Match body, html, and root background to current theme so safe-area insets blend in
    document.documentElement.style.background = c.bg;
    document.body.style.background = c.bg;
    const root = document.getElementById("root");
    if (root) root.style.background = c.bg;
  }, [c.bg]);

  return (
    <div style={{ width:"100vw", height:"100dvh", background:c.bg, display:"flex", flexDirection:"column", fontFamily:"'DM Sans',sans-serif", overflow:"hidden", paddingTop:"env(safe-area-inset-top)", paddingBottom:"env(safe-area-inset-bottom)", paddingLeft:"env(safe-area-inset-left)", paddingRight:"env(safe-area-inset-right)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=Noto+Naskh Arabic:wght@400;500;600&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
        ::-webkit-scrollbar { display:none; }
        input,select,textarea { outline:none; font-family:'DM Sans',sans-serif; }
        @keyframes fu { from{opacity:0;transform:translateY(13px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        @keyframes bkmSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes shakeX { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }
        @keyframes priceReveal { 0%{opacity:0;transform:scale(0.92) translateY(6px)} 60%{transform:scale(1.03)} 100%{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes upBurst { 0%{transform:scale(1)} 35%{transform:scale(1.4) translateY(-4px)} 65%{transform:scale(0.92)} 100%{transform:scale(1)} }
        @keyframes downSink { 0%{transform:scale(1)} 40%{transform:scale(0.85) translateY(3px)} 100%{transform:scale(1)} }
        @keyframes scaleIn { 0%{opacity:0;transform:scale(0.8)} 60%{transform:scale(1.04)} 100%{opacity:1;transform:scale(1)} }
        @keyframes bookmarkPop { 0%{transform:scale(1)} 30%{transform:scale(1.5) rotate(-10deg)} 60%{transform:scale(0.9) rotate(5deg)} 100%{transform:scale(1) rotate(0deg)} }
        @keyframes shareSlide { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes newCard { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideDown { from{opacity:0;transform:translateY(-12px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div style={{ width:"100%", height:"100%", background:c.bg, display:"flex", flexDirection:"column", transition:"background 0.35s ease", opacity:fading?0:1, overflow:"hidden" }}>

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div style={{ position:"absolute", top:60, left:"50%", transform:"translateX(-50%)", zIndex:500, display:"flex", flexDirection:"column", gap:8, width:335, pointerEvents:"none" }}>
          {toasts.map(t => {
            const tone = t.type==="upvote" ? c.accent : t.type==="approve" ? "#16A34A" : "#8B0038";
            const tintBg = t.type==="upvote" ? `${c.accent}15` : t.type==="approve" ? "#16A34A15" : "#8B003815";
            const Icon = (() => {
              if (t.type==="upvote")  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tone} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l4.41-7.41A2 2 0 0 1 13.07 2H14a2 2 0 0 1 2 2v1.88z"/></svg>;
              if (t.type==="approve") return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tone} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
              return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tone} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
            })();
            return (
              <div key={t.id} style={{ background:theme==="dark"?"#1A1810":"#FFFFFF", border:`1px solid ${tone}55`, borderRadius:14, padding:"10px 14px", display:"flex", alignItems:"center", gap:10, boxShadow:"0 4px 20px rgba(0,0,0,0.2)", animation:"slideDown 0.35s cubic-bezier(0.34,1.2,0.64,1) both" }}>
                <div style={{ width:30, height:30, borderRadius:9, background:tintBg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  {Icon}
                </div>
                <span style={{ fontSize:12, fontWeight:600, color:c.text, fontFamily:"'DM Sans',sans-serif", flex:1 }}>{t.msg}</span>
              </div>
            );
          })}
        </div>
      )}

        {/* Progress dots for auth screens */}
        {/* Progress dots for auth/setup screens */}
        {["register","login","otp","consent","profile"].includes(screen) && (
          <div style={{ display:"flex", gap:5, justifyContent:"center", paddingTop:4, flexShrink:0 }}>
            {[1,2,3,4].map(i=>{
              const step = screen==="register"||screen==="login"?1:screen==="otp"?2:screen==="consent"?3:4;
              return <div key={i} style={{ height:3, borderRadius:2, transition:"all 0.3s", width:step>=i?22:7, background:step>=i?c.accent:c.muted }}/>;
            })}
          </div>
        )}

        {/* Screens */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {screen==="opening"    && <Opening
            onStart={()=>go("register")}
            onLogin={()=>go("login")}
            onMerchant={()=>go("merchantLogin")}
            onDev={async ()=>{
              try {
                const { uid, isNew } = await fbSignInDev();
                if (isNew) {
                  // First-time DEV: create the user doc with admin + founder flags
                  await fbCreateUserDoc(uid, {
                    username: "swiss",
                    avatar: "a3",
                    isAdmin: true,
                    isFounder: true,
                    profileSetup: true,
                    tosAccepted: true,
                    rank: 2,
                  });
                } else {
                  // Existing dev account: ensure flags
                  await fbUpdateUserDoc(uid, { isAdmin: true, isFounder: true }).catch(()=>{});
                }
                SESSION.loggedIn=true; SESSION.isAdmin=true; SESSION.isFounder=true;
                CURRENT_USER = ME;
                setIsAdmin(true);
                go("feed");
              } catch (e) {
                // Fallback: stay in-memory admin if Firebase fails
                SESSION.loggedIn=true; SESSION.isAdmin=true; SESSION.isFounder=true;
                CURRENT_USER = ME;
                setIsAdmin(true);
                go("feed");
              }
            }}
            themeMode={themeMode} setThemeMode={setThemeMode} theme={theme} lang={lang} setLang={setLang}
          />}
          {screen==="register"      && <Register theme={theme} lang={lang} onNext={(phone, email)=>{
            // Firebase signup already happened inside Register. Just save phone+email and move to OTP theater.
            if (fbAuth.currentUser) fbUpdateUserDoc(fbAuth.currentUser.uid, { phone: normalizePhone(phone), email }).catch(()=>{});
            go("otp");
          }} onBack={()=>go("opening")} onLogin={()=>go("login")}/>}
          {screen==="login"         && <Login    theme={theme} lang={lang} onNext={(phone, email)=>{
            // Firebase signin already happened. Save phone for ref and move forward.
            if (fbAuth.currentUser) fbUpdateUserDoc(fbAuth.currentUser.uid, { phone: normalizePhone(phone), email }).catch(()=>{});
            go("otp");
          }} onBack={()=>go("opening")} onRegister={()=>go("register")}/>}
          {screen==="otp"           && <OTP      theme={theme} lang={lang} onVerify={()=>{
            // Decide where to route based on the loaded user doc (mirrored on SESSION)
            if (!SESSION.tosAccepted) go("consent");
            else if (!SESSION.profileSetup) go("profile");
            else go("feed");
          }} onBack={()=>go("register")}/>}
          {screen==="consent"       && <BetaConsent theme={theme} onAccept={async ()=>{
            SESSION.tosAccepted=true;
            if (fbAuth.currentUser) await fbUpdateUserDoc(fbAuth.currentUser.uid, { tosAccepted:true }).catch(()=>{});
            // If user already has profile (returning incomplete signup), skip ahead
            go(SESSION.profileSetup ? "feed" : "profile");
          }}/>}
          {screen==="profile"       && <ProfileSetup theme={theme} lang={lang} onComplete={async (data)=>{
            SESSION.profileSetup=true;
            SESSION.username=data.username;
            SESSION.avatar=data.avatar;
            CURRENT_USER = { id: fbAuth.currentUser?.uid || 0, uid: fbAuth.currentUser?.uid, username:data.username, name:null, av:data.avatar, rank:0, founder:!!SESSION.isFounder, caption:"", deals:0, followers:0 };
            if (fbAuth.currentUser) await fbUpdateUserDoc(fbAuth.currentUser.uid, { username:data.username.toLowerCase(), avatar:data.avatar, profileSetup:true }).catch(()=>{});
            go("onboarding");
          }}/>}
          {screen==="onboarding"    && <Onboarding theme={theme} onComplete={async (interests)=>{
            SESSION.loggedIn=true; SESSION.interests=interests||[];
            if (fbAuth.currentUser) await fbUpdateUserDoc(fbAuth.currentUser.uid, { interests: interests||[] }).catch(()=>{});
            go("feed");
          }}/>}
          {screen==="merchantLogin" && <MerchantLogin theme={theme} lang={lang} onLogin={()=>{ SESSION.loggedIn=true; go("merchantPortal"); }} onBack={()=>go("opening")} onApply={()=>{ setPartnerOrigin("merchantLogin"); go("partner"); }}/>}
          {screen==="merchantPortal"&& <MerchantPortal theme={theme} lang={lang} onSignOut={()=>{ SESSION.isMerchant=false; SESSION.loggedIn=false; SESSION.merchantName=""; SESSION.merchantCategory=""; go("opening"); }}/>}
          {screen==="partner"       && <PartnerRequest theme={theme} lang={lang} onBack={()=>{
            const target = partnerOrigin === "merchantLogin" ? "merchantLogin" : (SESSION.loggedIn ? "feed" : "opening");
            go(target);
          }} onSubmitted={()=>{
            const target = partnerOrigin === "merchantLogin" ? "merchantLogin" : (SESSION.loggedIn ? "feed" : "opening");
            go(target);
          }}/>}
          {screen==="community"      && <ErrorBoundary><CommunityDetail theme={theme} lang={lang} communityId={activeCommunityId} onBack={()=>{ go("feed"); setTab("communities"); }} onPostInCommunity={()=>{ /* Session 2: post-to-community */ }}/></ErrorBoundary>}
          {screen==="createCommunity"&& <ErrorBoundary><CreateCommunity theme={theme} lang={lang} onBack={()=>{ go("feed"); setTab("communities"); }} onCreated={(cid)=>{ setActiveCommunityId(cid); go("community"); }}/></ErrorBoundary>}
          {screen==="feed"          && renderTab()}
        </div>

        {/* Bottom nav — 5 tabs, split with divider */}
        {showTabs && (
          <div style={{ height:64, borderTop:`1px solid ${c.border}`, display:"flex", alignItems:"center", background:c.bg, flexShrink:0 }}>
            {/* Left — consumer side (Feed, Search, Communities) */}
            <div style={{ flex:1.5, display:"flex", alignItems:"center", justifyContent:"space-around" }}>
              {[
                { key:"feed",        label:"Feed",   Ico:Ico.Home   },
                { key:"search",      label:"Search", Ico:Ico.Search },
                { key:"communities", label:"Comms",  isCommunities:true },
              ].map(item => {
                const active = !pushedScreen && tab===item.key;
                return (
                  <button key={item.key} onClick={()=>{ sfx.tap(); setPushed(null); setTab(item.key); }} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:"none", border:"none", cursor:"pointer", padding:"6px 8px" }}>
                    {item.isCommunities ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active?c.accent:c.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    ) : (
                      <item.Ico s={20} c={active?c.accent:c.sub}/>
                    )}
                    <span style={{ fontSize:9, fontWeight:active?700:400, color:active?c.accent:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.04em" }}>{item.label}</span>
                  </button>
                );
              })}
            </div>
            {/* Divider */}
            <div style={{ width:1, height:32, background:c.border, flexShrink:0 }}/>
            {/* Right — contributor side (Post, Profile) */}
            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"space-around" }}>
              {[
                { key:"post",    label:"Post",    Ico:Ico.Plus   },
                { key:"profile", label:"Profile", Ico:Ico.Person },
              ].map(item => {
                const active = !pushedScreen && tab===item.key;
                return (
                  <button key={item.key} onClick={()=>{ sfx.tap(); setPushed(null); setTab(item.key); }} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:"none", border:"none", cursor:"pointer", padding:"6px 12px" }}>
                    <item.Ico s={20} c={active?c.accent:c.sub}/>
                    <span style={{ fontSize:9, fontWeight:active?700:400, color:active?c.accent:c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.04em" }}>{item.label}</span>
                  </button>
                );
              })}
            </div>
            {/* DEV divider + tab — admin only */}
            {isAdmin && (
              <>
                <div style={{ width:1, height:32, background:c.border, flexShrink:0 }}/>
                <button onClick={()=>{ setPushed(null); setTab("dev"); }} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:"none", border:"none", cursor:"pointer", padding:"6px 10px", position:"relative" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={!pushedScreen&&tab==="dev"?"#1D6FEB":c.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  {pendingPosts.length > 0 && (
                    <div style={{ position:"absolute", top:4, right:4, width:16, height:16, borderRadius:"50%", background:"#EF4444", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <span style={{ fontSize:9, fontWeight:800, color:"#FFFFFF", fontFamily:"'DM Sans',sans-serif" }}>{pendingPosts.length}</span>
                    </div>
                  )}
                  <span style={{ fontSize:9, fontWeight:!pushedScreen&&tab==="dev"?700:400, color:!pushedScreen&&tab==="dev"?"#1D6FEB":c.sub, fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.04em" }}>DEV</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* Home bar for non-app screens */}
        {!showTabs && (
          <div style={{ height:34, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <div style={{ width:120, height:5, background:c.muted, borderRadius:3 }}/>
          </div>
        )}

      </div>
    </div>
  );
}
