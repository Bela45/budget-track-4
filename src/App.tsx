/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { CATS, CURR, Transaction, UsersMap } from './types';
import { auth, db } from './firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  updateProfile,
  User
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  collection, 
  addDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy,
  serverTimestamp
} from 'firebase/firestore';

// Initialize Gemini AI
const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || 'dummy-key' });

export default function App() {
  // ══ STATE ══
  const [view, setView] = useState<'login' | 'app'>('login');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [curUser, setCurUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // App Data
  const [data, setData] = useState<Transaction[]>([]);
  const [wallet, setWallet] = useState<number>(0);
  const [goal, setGoal] = useState<number>(0);
  const [curCode, setCurCode] = useState<string>('PHP');
  
  // UI State
  const [calDate, setCalDate] = useState(new Date());
  const [selDay, setSelDay] = useState<string | null>(null);
  const [curFilter, setCurFilter] = useState<string>('all');
  const [curType, setCurType] = useState<'expense' | 'saving'>('expense');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<{role: 'bot' | 'user', text: string}[]>([
    { role: 'bot', text: "👋 Hi! I'm your **Gemini AI** budget assistant — fully connected and ready to help! Add some transactions, then ask me anything about your spending, savings, or budget goals. I'll give you personalized insights based on your real data! 💰" }
  ]);
  const [aiLoading, setAiLoading] = useState(false);
  const [insightLoading, setInsightLoading] = useState<'insight' | 'tips' | 'forecast' | null>(null);
  const [insightText, setInsightText] = useState<string>("Your Gemini AI is connected and ready! Add some transactions and click **Analyze** to get personalized budget insights powered by Google Gemini AI.");

  // Inputs
  const [authInputs, setAuthInputs] = useState({ user: '', pass: '', name: '' });
  const [transInputs, setTransInputs] = useState({ desc: '', amount: '', cat: 'food', date: new Date().toISOString().split('T')[0] });
  const [walletInput, setWalletInput] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [aiInput, setAiInput] = useState('');

  // ══ EFFECTS ══
  
  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurUser(user);
      if (user) {
        setView('app');
      } else {
        setView('login');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Data Listener (Firestore)
  useEffect(() => {
    if (!curUser) {
      setData([]);
      setWallet(0);
      setGoal(0);
      return;
    }

    // Listen to User Doc (Wallet, Goal, Currency)
    const userRef = doc(db, 'users', curUser.uid);
    const unsubUser = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        const d = docSnap.data();
        setWallet(d.wallet || 0);
        setGoal(d.goal || 0);
        setCurCode(d.curCode || 'PHP');
      }
    });

    // Listen to Transactions Subcollection
    const q = query(collection(db, 'users', curUser.uid, 'transactions'), orderBy('date', 'desc'), orderBy('createdAt', 'desc'));
    const unsubTrans = onSnapshot(q, (snapshot) => {
      const trans: Transaction[] = [];
      snapshot.forEach((doc) => {
        trans.push({ id: doc.id, ...doc.data() } as Transaction);
      });
      setData(trans);
    });

    return () => {
      unsubUser();
      unsubTrans();
    };
  }, [curUser]);

  // Save data when it changes - REMOVED (Handled by Firestore listeners)
  // useEffect(() => { ... }, [data, wallet, goal, curCode, curUser]);

  // ══ HELPERS ══
  const sym = CURR[curCode]?.sym || '₱';
  const fmt = (n: number) => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  };

  // ══ AUTH ══
  const handleAuth = async () => {
    const { user, pass, name } = authInputs; // user is email here
    if (!user || !pass) return showToast('Please fill all fields');
    
    try {
      if (authMode === 'register') {
        const userCred = await createUserWithEmailAndPassword(auth, user, pass);
        await updateProfile(userCred.user, { displayName: name || user.split('@')[0] });
        
        // Create initial user doc
        await setDoc(doc(db, 'users', userCred.user.uid), {
          name: name || user.split('@')[0],
          email: user,
          wallet: 0,
          goal: 0,
          curCode: 'PHP',
          createdAt: serverTimestamp()
        });
        
        showToast('✅ Account created!');
      } else {
        await signInWithEmailAndPassword(auth, user, pass);
        showToast('👋 Welcome back!');
      }
      setAuthInputs({ user: '', pass: '', name: '' });
    } catch (error: any) {
      console.error(error);
      let msg = 'Authentication failed';
      if (error.code === 'auth/email-already-in-use') msg = 'Email already in use';
      if (error.code === 'auth/invalid-email') msg = 'Invalid email address';
      if (error.code === 'auth/weak-password') msg = 'Password should be at least 6 characters';
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') msg = 'Invalid email or password';
      showToast('❌ ' + msg);
    }
  };

  // loginUser removed (handled by onAuthStateChanged)

  const logout = async () => {
    if (!confirm('Log out?')) return;
    await signOut(auth);
  };

  // ══ TRANSACTIONS ══
  const addEntry = async () => {
    if (!curUser) return;
    const { desc, amount, cat, date } = transInputs;
    if (!desc) return showToast('Enter description');
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return showToast('Invalid amount');
    if (!date) return showToast('Select date');

    try {
      await addDoc(collection(db, 'users', curUser.uid, 'transactions'), {
        desc,
        amount: amt,
        cat,
        date,
        type: curType,
        createdAt: serverTimestamp()
      });
      
      setTransInputs({ ...transInputs, desc: '', amount: '' });
      showToast(curType === 'expense' ? '📉 Expense added!' : '💰 Saving recorded!');
    } catch (e) {
      console.error(e);
      showToast('Error adding transaction');
    }
  };

  const deleteEntry = async (id: string | number) => {
    if (!curUser) return;
    try {
      await deleteDoc(doc(db, 'users', curUser.uid, 'transactions', String(id)));
    } catch (e) {
      console.error(e);
      showToast('Error deleting transaction');
    }
  };

  const resetAll = async () => {
    if (!curUser || !confirm('Reset ALL data? This cannot be undone.')) return;
    try {
      // Reset Wallet & Goal
      await updateDoc(doc(db, 'users', curUser.uid), {
        wallet: 0,
        goal: 0
      });
      
      // Delete all transactions
      // Note: Client-side batch delete is limited, but sufficient here.
      data.forEach(async (t) => {
        await deleteDoc(doc(db, 'users', curUser.uid, 'transactions', String(t.id)));
      });
      
      showToast('🔄 All data reset');
    } catch (e) {
      console.error(e);
      showToast('Error resetting data');
    }
  };

  const updateWallet = async (val: number) => {
    if (!curUser) return;
    await updateDoc(doc(db, 'users', curUser.uid), { wallet: val });
  };

  const updateGoal = async (val: number) => {
    if (!curUser) return;
    await updateDoc(doc(db, 'users', curUser.uid), { goal: val });
  };

  const updateCurrency = async (code: string) => {
    if (!curUser) return;
    await updateDoc(doc(db, 'users', curUser.uid), { curCode: code });
  };

  // ══ AI ══
  const buildContext = () => {
    const exp = data.filter(e => e.type === 'expense');
    const sav = data.filter(e => e.type === 'saving');
    const totalExp = exp.reduce((a, b) => a + b.amount, 0);
    const totalSav = sav.reduce((a, b) => a + b.amount, 0);
    const catBreak: Record<string, number> = {};
    exp.forEach(e => { catBreak[e.cat] = (catBreak[e.cat] || 0) + e.amount; });

    return `USER BUDGET DATA:
- Currency: ${curCode} (${sym})
- Budget/Wallet: ${sym}${fmt(wallet)}
- Total Expenses: ${sym}${fmt(totalExp)}
- Total Savings: ${sym}${fmt(totalSav)}
- Remaining Balance: ${sym}${fmt(Math.max(wallet - totalExp, 0))}
- Savings Goal: ${sym}${fmt(goal)}
- Progress to Goal: ${goal > 0 ? Math.round((totalSav / goal) * 100) : 0}%
- Category Spending: ${JSON.stringify(catBreak)}
- Recent Transactions (last 15): ${JSON.stringify(data.slice(0, 15).map(e => ({ desc: e.desc, amount: e.amount, cat: e.cat, type: e.type, date: e.date })))}
- Total Records: ${data.length}`;
  };

  const callGemini = async (prompt: string, maxTokens = 600) => {
    if (!apiKey) {
      return "⚠️ API Key is missing. Please set GEMINI_API_KEY in the Secrets panel.";
    }
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          maxOutputTokens: maxTokens,
          temperature: 0.75,
        }
      });
      return response.text;
    } catch (e: any) {
      console.error("Gemini API Error:", e);
      let msg = e.message || 'AI Error';
      if (msg.includes('404')) msg = 'Model not found or API key invalid.';
      else if (msg.includes('403')) msg = 'API key invalid or quota exceeded.';
      return '⚠️ ' + msg;
    }
  };

  const generateInsight = async (type: 'insight' | 'tips' | 'forecast') => {
    if (!data.length) return showToast('Add transactions first!');
    setInsightLoading(type);
    
    let prompt = buildContext();
    if (type === 'insight') prompt += `\n\nYou are a friendly personal finance advisor. Give a concise, personalized budget analysis in 3-4 sentences. Use the EXACT numbers from the data. Mention one strength and one improvement. Be encouraging but specific. Use bold for key numbers.`;
    else if (type === 'tips') prompt += `\n\nYou are a personal finance coach. Based on this spending data, give 3 specific, actionable money-saving tips. Number each tip. Be very specific using their actual spending categories and amounts. Keep each tip to 1-2 sentences.`;
    else if (type === 'forecast') prompt += `\n\nBased on current spending patterns, give a brief 30-day financial forecast in 3-4 sentences. Project estimated monthly expenses, savings rate, and whether they'll hit their savings goal. Use bold for key projected numbers. Be specific.`;

    const result = await callGemini(prompt);
    setInsightText(result || 'Could not generate insight.');
    setInsightLoading(null);
  };

  const aiAutoCategory = async () => {
    const { desc } = transInputs;
    if (!desc) return showToast('Enter description first');
    showToast('🤖 AI detecting category...');
    const prompt = `Categorize this expense: "${desc}"\nReply with ONLY one word from: food, transport, shopping, health, bills, entertainment, education, others`;
    const result = await callGemini(prompt, 10);
    if (result) {
      const clean = result.trim().toLowerCase().replace(/[^a-z]/g, '');
      const valid = Object.keys(CATS);
      const match = valid.find(v => clean.includes(v)) || 'others';
      setTransInputs({ ...transInputs, cat: match });
      showToast('🤖 Category: ' + CATS[match].label);
    }
  };

  const sendAiMsg = async () => {
    const msg = aiInput.trim();
    if (!msg) return;
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', text: msg }]);
    setAiLoading(true);

    const prompt = buildContext() + `\n\nUser asks: "${msg}"\n\nYou are a friendly, helpful personal finance AI assistant. Answer using their REAL budget data above. Be specific, concise (under 130 words), and helpful. Use bold for key numbers/amounts.`;
    const result = await callGemini(prompt, 512);
    
    setAiMessages(prev => [...prev, { role: 'bot', text: result || 'Sorry, I could not respond.' }]);
    setAiLoading(false);
  };

  // ══ RENDER HELPERS ══
  const filteredData = useMemo(() => {
    let f = data;
    if (curFilter === 'expense' || curFilter === 'saving') f = data.filter(e => e.type === curFilter);
    else if (curFilter !== 'all') f = data.filter(e => e.cat === curFilter);
    if (selDay) f = f.filter(e => e.date === selDay);
    return f;
  }, [data, curFilter, selDay]);

  const summary = useMemo(() => {
    const exp = data.filter(e => e.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const sav = data.filter(e => e.type === 'saving').reduce((a, b) => a + b.amount, 0);
    return { exp, sav, bal: Math.max(wallet - exp, 0) };
  }, [data, wallet]);

  const donutData = useMemo(() => {
    const exps = data.filter(e => e.type === 'expense');
    const total = exps.reduce((a, b) => a + b.amount, 0);
    const ct: Record<string, number> = {};
    exps.forEach(e => { ct[e.cat] = (ct[e.cat] || 0) + e.amount; });
    
    let off = 0;
    const r = 48, circ = 2 * Math.PI * r;
    const segments = Object.entries(ct).sort((a, b) => b[1] - a[1]).map(([cat, val]) => {
      const dash = (val / total) * circ;
      const gap = circ - dash;
      const seg = { cat, val, dash, gap, off };
      off += dash;
      return seg;
    });
    return { segments, total };
  }, [data]);

  // Calendar Grid
  const calendarDays = useMemo(() => {
    const y = calDate.getFullYear();
    const m = calDate.getMonth();
    const fd = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const today = new Date();
    const expenseDates = new Set(data.filter(e => e.type === 'expense').map(e => e.date));
    
    const cells = [];
    for (let i = 0; i < fd; i++) cells.push({ type: 'empty', key: `e-${i}` });
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
      cells.push({ 
        type: 'day', 
        day: d, 
        ds, 
        isToday, 
        hasExp: expenseDates.has(ds),
        isSelected: selDay === ds 
      });
    }
    return cells;
  }, [calDate, data, selDay]);

  // ══ RENDER ══
  if (view === 'login') {
    return (
      <div id="loginScreen">
        <div className="login-box">
          <div className="login-logo">💰</div>
          <div className="login-title">Budget Central</div>
          <div className="login-sub">AI-Powered Tracker</div>
          <div className="ai-powered-badge">
            <div className="ai-powered-dot"></div>
            Gemini AI Ready
          </div>
          <div className="auth-tabs">
            <button className={`auth-tab ${authMode === 'login' ? 'active' : ''}`} onClick={() => setAuthMode('login')}>Sign In</button>
            <button className={`auth-tab ${authMode === 'register' ? 'active' : ''}`} onClick={() => setAuthMode('register')}>Sign Up</button>
          </div>
          {authMode === 'register' && (
            <div className="lf">
              <label className="ll">Full Name</label>
              <input className="li" type="text" placeholder="e.g. Juan dela Cruz" 
                value={authInputs.name} onChange={e => setAuthInputs({...authInputs, name: e.target.value})} />
            </div>
          )}
          <div className="lf">
            <label className="ll">Username</label>
            <input className="li" type="text" placeholder="Enter username" 
              value={authInputs.user} onChange={e => setAuthInputs({...authInputs, user: e.target.value})}
              onKeyDown={e => e.key === 'Enter' && handleAuth()} />
          </div>
          <div className="lf">
            <label className="ll">Password</label>
            <input className="li" type="password" placeholder="Enter password" 
              value={authInputs.pass} onChange={e => setAuthInputs({...authInputs, pass: e.target.value})}
              onKeyDown={e => e.key === 'Enter' && handleAuth()} />
          </div>
          <button className="auth-btn" onClick={handleAuth}>{authMode === 'login' ? 'Sign In' : 'Create Account'}</button>
          <div className="auth-hint">Sign up with any username & password to get started.</div>
          {toastMsg && <div className="auth-err" style={{color: 'var(--rose)'}}>{toastMsg}</div>}
        </div>
      </div>
    );
  }

  return (
    <div id="appShell" style={{display: 'flex', flexDirection: 'column', minHeight: '100vh'}}>
      {/* HEADER */}
      <div className="header">
        <div className="brand">
          <div className="brand-icon">💰</div>
          <div className="brand-name">Budget Central</div>
        </div>
        <div className="hdr-right">
          <div className="hdr-date">
            {new Date().toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'})}
          </div>
          <select className="cur-select" value={curCode} onChange={e => updateCurrency(e.target.value)}>
            {Object.entries(CURR).map(([c, {sym}]) => (
              <option key={c} value={c}>{c} {sym}</option>
            ))}
          </select>
          <div className="ai-badge">
            <div className="ai-badge-dot"></div>
            <span>Gemini AI</span>
          </div>
          <div className="user-pill" onClick={logout} title="Logout">
            <div className="user-avatar">{curUser?.displayName?.[0]?.toUpperCase() || 'U'}</div>
            <span>{curUser?.displayName?.split(' ')[0] || 'User'}</span>
            <span>🚪</span>
          </div>
        </div>
      </div>

      <div className="container">
        {/* SUMMARY */}
        <div className="sum-grid">
          <div className="sum-card wallet">
            <div className="sum-icon">👛</div>
            <div className="sum-label">Wallet</div>
            <div className="sum-amount" style={{color: 'var(--gold)'}}>{sym}{fmt(summary.bal)}</div>
          </div>
          <div className="sum-card expenses">
            <div className="sum-icon">📉</div>
            <div className="sum-label">Expenses</div>
            <div className="sum-amount" style={{color: 'var(--rose)'}}>{sym}{fmt(summary.exp)}</div>
          </div>
          <div className="sum-card savings">
            <div className="sum-icon">🏦</div>
            <div className="sum-label">Savings</div>
            <div className="sum-amount" style={{color: 'var(--mint)'}}>{sym}{fmt(summary.sav)}</div>
          </div>
        </div>

        {/* AI INSIGHT */}
        <div className="insight-card">
          <div className="insight-header">
            <span style={{fontSize: '22px'}}>✨</span>
            <div className="insight-title">AI Financial Insight</div>
          </div>
          <div className="insight-body" dangerouslySetInnerHTML={{
            __html: insightText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
          }} />
          <div className="insight-actions">
            <button className="insight-btn" disabled={!!insightLoading} onClick={() => generateInsight('insight')}>
              <span className={insightLoading === 'insight' ? 'spin' : ''}>{insightLoading === 'insight' ? '⟳' : '✨'}</span> Analyze My Budget
            </button>
            <button className="insight-btn" disabled={!!insightLoading} onClick={() => generateInsight('tips')}>
              <span className={insightLoading === 'tips' ? 'spin' : ''}>{insightLoading === 'tips' ? '⟳' : '💡'}</span> Saving Tips
            </button>
            <button className="insight-btn" disabled={!!insightLoading} onClick={() => generateInsight('forecast')}>
              <span className={insightLoading === 'forecast' ? 'spin' : ''}>{insightLoading === 'forecast' ? '⟳' : '📈'}</span> Forecast
            </button>
          </div>
        </div>

        <div className="main-grid">
          <div>
            {/* CALENDAR */}
            <div className="card">
              <div className="card-title">📅 Calendar</div>
              <div className="cal-nav">
                <button className="cal-btn" onClick={() => setCalDate(new Date(calDate.setMonth(calDate.getMonth() - 1)))}>‹</button>
                <div className="cal-month">{calDate.toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}</div>
                <button className="cal-btn" onClick={() => setCalDate(new Date(calDate.setMonth(calDate.getMonth() + 1)))}>›</button>
              </div>
              <div className="cal-grid">
                {['S','M','T','W','T','F','S'].map((d, i) => <div key={i} className="cal-dh">{d}</div>)}
                {calendarDays.map((c: any) => (
                  c.type === 'empty' ? <div key={c.key} className="cal-d empty"></div> :
                  <div key={c.ds} 
                    className={`cal-d ${c.isToday ? 'today' : ''} ${c.hasExp ? 'has-exp' : ''} ${c.isSelected ? 'selected' : ''}`}
                    onClick={() => setSelDay(c.ds === selDay ? null : c.ds)}
                  >
                    {c.day}
                  </div>
                ))}
              </div>
            </div>

            {/* DONUT */}
            <div className="card">
              <div className="card-title">🥧 Spending by Category</div>
              <div className="donut-wrap">
                <div className="donut-svg-wrap">
                  <svg className="donut-svg" width="130" height="130" viewBox="0 0 130 130">
                    <circle cx="65" cy="65" r="48" fill="none" stroke="#1e2330" strokeWidth="20"/>
                    {donutData.segments.map((s, i) => (
                      <circle key={s.cat} cx="65" cy="65" r="48" fill="none" 
                        stroke={CATS[s.cat]?.color || '#7a8299'} 
                        strokeWidth="20" 
                        strokeDasharray={`${s.dash} ${s.gap}`} 
                        strokeDashoffset={-s.off} 
                        strokeLinecap="butt" 
                      />
                    ))}
                  </svg>
                  <div className="donut-center">
                    <div className="donut-pct">
                      {wallet > 0 ? Math.min(Math.round((donutData.total / wallet) * 100), 100) : 0}%
                    </div>
                    <div className="donut-sub">spent</div>
                  </div>
                </div>
                <div className="legend">
                  {donutData.segments.length === 0 ? <div style={{color: 'var(--muted)', fontSize: '12px'}}>No data yet</div> :
                    donutData.segments.map(s => (
                      <div key={s.cat} className="leg-item">
                        <div className="leg-dot" style={{background: CATS[s.cat]?.color}}></div>
                        <div className="leg-name">{CATS[s.cat]?.label}</div>
                        <div className="leg-val" style={{color: CATS[s.cat]?.color}}>{sym}{fmt(s.val)}</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          </div>

          <div>
            {/* ADD FORM */}
            <div className="card">
              <div className="card-title">➕ Add Transaction</div>
              <div className="form-row">
                <label className="form-label">💼 Set Wallet Balance</label>
                <div style={{display: 'flex', gap: '8px'}}>
                  <input type="number" className="form-input" placeholder="Enter budget..." style={{flex: 1}}
                    value={walletInput} onChange={e => setWalletInput(e.target.value)} />
                  <button className="btn btn-gold" style={{width: 'auto', padding: '10px 14px', marginTop: 0}}
                    onClick={() => {
                      const v = parseFloat(walletInput);
                      if (!isNaN(v)) { updateWallet(v); setWalletInput(''); showToast('💼 Wallet updated!'); }
                    }}>Set</button>
                </div>
              </div>
              <div className="type-toggle">
                <button className={`type-btn ${curType === 'expense' ? 'ae' : ''}`} onClick={() => setCurType('expense')}>📉 Expense</button>
                <button className={`type-btn ${curType === 'saving' ? 'as' : ''}`} onClick={() => setCurType('saving')}>💰 Saving</button>
              </div>
              <div className="form-2">
                <div className="form-row">
                  <label className="form-label">Description</label>
                  <input type="text" className="form-input" placeholder="e.g. Groceries"
                    value={transInputs.desc} onChange={e => setTransInputs({...transInputs, desc: e.target.value})} />
                </div>
                <div className="form-row">
                  <label className="form-label">Amount ({sym})</label>
                  <input type="number" className="form-input" placeholder="0.00"
                    value={transInputs.amount} onChange={e => setTransInputs({...transInputs, amount: e.target.value})} />
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">Category</label>
                <div style={{display: 'flex', gap: '8px'}}>
                  <select className="form-select" style={{flex: 1}}
                    value={transInputs.cat} onChange={e => setTransInputs({...transInputs, cat: e.target.value})}>
                    {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                  <button className="btn btn-gold" style={{width: 'auto', padding: '10px 12px', marginTop: 0, fontSize: '12px', whiteSpace: 'nowrap'}}
                    onClick={aiAutoCategory} title="AI auto-detect">🤖 Auto</button>
                </div>
              </div>
              <div className="form-row">
                <label className="form-label">Date</label>
                <input type="date" className="form-input"
                  value={transInputs.date} onChange={e => setTransInputs({...transInputs, date: e.target.value})} />
              </div>
              <div className="btn-row">
                <button className="btn btn-gold" onClick={addEntry}>➕ Add</button>
                <button className="btn btn-reset" onClick={resetAll}>🔄 Reset</button>
              </div>
            </div>

            {/* SAVINGS GOAL */}
            <div className="card">
              <div className="card-title">🎯 Savings Goal</div>
              <div className="form-row" style={{display: 'flex', gap: '8px', marginBottom: '10px'}}>
                <input type="number" className="form-input" placeholder="Set savings goal..." style={{flex: 1}}
                  value={goalInput} onChange={e => setGoalInput(e.target.value)} />
                <button className="btn btn-gold" style={{width: 'auto', padding: '10px 14px', marginTop: 0}}
                  onClick={() => {
                    const v = parseFloat(goalInput);
                    if (!isNaN(v)) { updateGoal(v); setGoalInput(''); showToast('🎯 Goal set!'); }
                  }}>Set</button>
              </div>
              <div className="sg-row">
                <span style={{color: 'var(--muted)'}}>Saved</span>
                <span>{sym}{fmt(summary.sav)} / {sym}{fmt(goal)}</span>
              </div>
              <div className="prog-bar">
                <div className="prog-fill" style={{width: `${goal > 0 ? Math.min((summary.sav / goal) * 100, 100) : 0}%`}}></div>
              </div>
            </div>
          </div>
        </div>

        {/* AI CHAT */}
        <div className="ai-panel">
          <div className="ai-panel-hdr">
            <div className="ai-panel-title">🤖 Ask Gemini AI</div>
            <div className="ai-panel-sub">Powered by Google Gemini 3 Flash</div>
          </div>
          <div className="ai-chips">
            {['Analyze my spending', 'Where can I save more?', 'Am I on budget?', 'Top expense category?', 'Give me saving tips', 'Monthly spending summary'].map(t => (
              <span key={t} className="ai-chip" onClick={() => { setAiInput(t); sendAiMsg(); }}>{t}</span>
            ))}
          </div>
          <div className="ai-messages">
            {aiMessages.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>
                <div className={`ai-avatar ${m.role === 'bot' ? 'bot' : 'usr'}`}>{m.role === 'bot' ? 'G' : '👤'}</div>
                <div className="ai-bubble" dangerouslySetInnerHTML={{
                  __html: m.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
                }} />
              </div>
            ))}
            {aiLoading && (
              <div className="ai-msg bot">
                <div className="ai-avatar bot">G</div>
                <div className="ai-bubble">
                  <div className="ai-thinking"><span></span><span></span><span></span></div>
                </div>
              </div>
            )}
          </div>
          <div className="ai-input-row">
            <input className="ai-txt" type="text" placeholder="Ask anything about your budget..."
              value={aiInput} onChange={e => setAiInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendAiMsg()} />
            <button className="ai-send" onClick={sendAiMsg}>➤</button>
          </div>
        </div>

        {/* LIST */}
        <div className="card">
          <div className="card-title">📋 Transaction History</div>
          <div className="filter-tabs">
            {['all', 'expense', 'saving', 'food', 'transport', 'shopping', 'health', 'bills', 'entertainment'].map(f => (
              <button key={f} className={`filter-tab ${curFilter === f ? 'active' : ''}`} onClick={() => setCurFilter(f)}>
                {f === 'all' ? 'All' : CATS[f]?.label || f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="p-list">
            {filteredData.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📭</div><div>No transactions found.</div></div>
            ) : (
              filteredData.map(e => (
                <div key={e.id} className="p-item">
                  <div className="cat-badge" style={{background: `${CATS[e.cat]?.color}22`}}>{CATS[e.cat]?.icon}</div>
                  <div className="p-info">
                    <div className="p-name">{e.desc}</div>
                    <div className="p-meta">{CATS[e.cat]?.label} • {e.date}</div>
                  </div>
                  <div className={`p-amt ${e.type}`}>{e.type === 'expense' ? '-' : '+'} {sym}{fmt(e.amount)}</div>
                  <button className="del-btn" onClick={() => deleteEntry(e.id)}>🗑</button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="footer">
        <strong>Design by A.Arrosas</strong> &nbsp;•&nbsp; Budget Central Tracker &nbsp;•&nbsp; &copy; 2025
        <span className="gemini-credit">✦ Powered by Google Gemini AI 3 Flash</span>
      </div>

      <div className={`toast ${toastMsg ? 'show' : ''}`}>{toastMsg}</div>
    </div>
  );
}

