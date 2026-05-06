/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  FileText, 
  Plus, 
  Trash2, 
  ChevronRight, 
  PieChart, 
  Leaf, 
  Utensils, 
  Sun, 
  Upload,
  AlertCircle,
  CheckCircle2,
  Loader2,
  History,
  Info,
  X,
  Send,
  MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { cn } from './utils';
import { PainRecord, PainIntensity, TCMAnalysis, MedicalReport } from './types';
import { translations } from './translations';
import { auth, db, signInWithGoogle, logout, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  addDoc, 
  deleteDoc, 
  doc, 
  setDoc,
  getDoc,
  orderBy,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [painRecords, setPainRecords] = useState<PainRecord[]>([]);
  const [reports, setReports] = useState<MedicalReport[]>([]);
  const [analysis, setAnalysis] = useState<TCMAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'records' | 'reports' | 'analysis'>('dashboard');
  const [showPainForm, setShowPainForm] = useState(false);
  const [selectedReport, setSelectedReport] = useState<MedicalReport | null>(null);
  const [hasNewData, setHasNewData] = useState(false);
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', content: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const t = translations[lang];
  
  // Loading messages for better UX
  const [loadingMessage, setLoadingMessage] = useState(translations[lang].loadingData);
  const [newPain, setNewPain] = useState({
    location: translations[lang].locations[0],
    intensity: PainIntensity.LOW,
    description: ''
  });
  const [customLocation, setCustomLocation] = useState('');

  // Auth & Sync Logic
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthLoading(false);
      
      if (user) {
        // Sync Basic Profile
        const userRef = doc(db, 'users', user.uid);
        getDoc(userRef).then(docSnap => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.lang) setLang(data.lang);
          } else {
            setDoc(userRef, {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              lang: lang,
              createdAt: serverTimestamp()
            });
          }
        });

        // Sync Pain Records
        const painRef = collection(db, 'users', user.uid, 'pain_records');
        const qPain = query(painRef, orderBy('date', 'desc'));
        const unsubPain = onSnapshot(qPain, (snap) => {
          const records = snap.docs.map(doc => ({ ...doc.data() } as PainRecord));
          setPainRecords(records);
        }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/pain_records`));

        // Sync Medical Reports
        const reportsRef = collection(db, 'users', user.uid, 'medical_reports');
        const unsubReports = onSnapshot(reportsRef, (snap) => {
          const docs = snap.docs.map(doc => ({ ...doc.data() } as MedicalReport));
          setReports(docs);
        }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/medical_reports`));

        // Sync Latest Analysis
        const analysisRef = doc(db, 'users', user.uid, 'analysis', 'latest');
        const unsubAnalysis = onSnapshot(analysisRef, (snap) => {
          if (snap.exists()) {
            setAnalysis(snap.data() as TCMAnalysis);
          }
        }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}/analysis/latest`));

        return () => {
          unsubPain();
          unsubReports();
          unsubAnalysis();
        };
      } else {
        setPainRecords([]);
        setReports([]);
        setAnalysis(null);
      }
    });

    return () => unsubscribe();
  }, [lang]);

  // Save language preference to Firestore if user exists
  useEffect(() => {
    if (user) {
      const userRef = doc(db, 'users', user.uid);
      setDoc(userRef, { lang }, { merge: true });
    }
  }, [lang, user]);

  // Track if there is new data to analyze
  useEffect(() => {
    if (painRecords.length > 0 || reports.length > 0) {
      setHasNewData(true);
    } else {
      setHasNewData(false);
    }
  }, [painRecords.length, reports.length]);

  const addPainRecord = async () => {
    if (!user) return;
    const recordId = Date.now().toString();
    
    // Use custom location if "Other" is selected
    const isOther = newPain.location === translations.zh.locations[translations.zh.locations.length - 1] || 
                   newPain.location === translations.en.locations[translations.en.locations.length - 1];
    
    const finalLocation = isOther && customLocation.trim() ? customLocation.trim() : newPain.location;

    const record: PainRecord = {
      id: recordId,
      date: new Date().toISOString(),
      location: finalLocation,
      intensity: newPain.intensity,
      description: newPain.description
    };
    
    try {
      await setDoc(doc(db, 'users', user.uid, 'pain_records', recordId), {
        ...record,
        userId: user.uid
      });
      setNewPain({ location: t.locations[0], intensity: PainIntensity.LOW, description: '' });
      setCustomLocation('');
      setShowPainForm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/pain_records`);
    }
  };

  const deleteRecord = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'pain_records', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/pain_records/${id}`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) return;
    const file = e.target.files?.[0];
    if (!file) return;

    // Limit to 1MB to stay within Firestore's 1MB document limit
    if (file.size > 1024 * 1024) {
      alert(t.fileTooLarge);
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result as string;
      
      let fileType: 'image' | 'pdf' | 'other' = 'other';
      if (file.type.includes('image')) fileType = 'image';
      else if (file.type.includes('pdf')) fileType = 'pdf';

      const reportId = Date.now().toString();
      const newReport: MedicalReport = {
        id: reportId,
        name: file.name,
        uploadDate: new Date().toISOString(),
        type: fileType,
        content: base64Data
      };
      
      try {
        await setDoc(doc(db, 'users', user.uid, 'medical_reports', reportId), {
          ...newReport,
          userId: user.uid
        });
        alert(t.uploadSuccess);
      } catch (error) {
        alert(t.uploadFailed);
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/medical_reports`);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const runAnalysis = async () => {
    if (!user) return;
    setIsAnalyzing(true);
    setLoadingMessage(t.loadingData);
    
    const messages = [
      t.loadingAncient,
      t.loadingMetrics,
      t.loadingCustomizing,
      t.loadingFinalizing
    ];
    
    let msgIndex = 0;
    const interval = setInterval(() => {
      setLoadingMessage(messages[msgIndex % messages.length]);
      msgIndex++;
    }, 2000);

    try {
      const prompt = `
        You are a senior Traditional Chinese Medicine (TCM) expert. 
        Please analyze the user's constitution based on the following health data.
        
        User's recent pain records:
        ${painRecords.slice(0, 10).map(r => `- ${new Date(r.date).toLocaleDateString()}: ${r.location} (${r.intensity}), Description: ${r.description}`).join('\n')}
        
        Please combine the pain records and uploaded medical reports (if any) for a comprehensive judgment.
        
        IMPORTANT: Provide the response in ${lang === 'zh' ? 'Chinese' : 'English'}.
        
        Please provide the analysis result in the following JSON format:
        {
          "constitutionType": "Name of constitution type",
          "characteristics": ["Feature 1", "Feature 2", "Feature 3"],
          "painAnalysis": "Long paragraph analyzing the cause of pain from a TCM perspective",
          "dietaryAdvice": ["Dietary advice 1", "Dietary advice 2", "Dietary advice 3"],
          "lifestyleAdvice": ["Lifestyle advice 1", "Lifestyle advice 2", "Lifestyle advice 3"],
          "herbalSuggestions": "Suggestions for suitable diet therapy or herbal tea"
        }
      `;

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          reports: reports.slice(0, 3).map(r => ({ content: r.content })),
          lang
        })
      });

      if (!response.ok) throw new Error('AI analysis failed');
      
      const analysisData = await response.json();
      
      // Save to Firestore
      await setDoc(doc(db, 'users', user.uid, 'analysis', 'latest'), {
        ...analysisData,
        userId: user.uid,
        updatedAt: serverTimestamp()
      });

      setAnalysis(analysisData);
      setHasNewData(false);
      setActiveTab('analysis');
    } catch (error) {
      console.error("Analysis failed:", error);
      alert(t.analysisFailed);
    } finally {
      clearInterval(interval);
      setIsAnalyzing(false);
    }
  };

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatLoading || !analysis || !user) return;

    const userMsg = chatInput.trim();
    setChatInput('');
    const newMessages = [...chatMessages, { role: 'user' as const, content: userMsg }];
    setChatMessages(newMessages);
    setIsChatLoading(true);

    try {
      const history = [
        {
          role: 'user',
          parts: [{
            text: `
              You are a TCM expert and nutritionist. 
              Context: The user has been analyzed with the constitution type: ${analysis.constitutionType}.
              Characteristics: ${analysis.characteristics.join(', ')}.
              Recent pain logs: ${painRecords.slice(0, 5).map(r => `${r.location}(${r.intensity})`).join(', ')}.
              
              Please answer the user's question about their diet or wellness in ${lang === 'zh' ? 'Chinese' : 'English'}.
              Be professional, warm, and helpful.
            `
          }]
        },
        ...chatMessages.map(m => ({
          role: m.role,
          parts: [{ text: m.content }]
        })),
        {
          role: 'user',
          parts: [{ text: userMsg }]
        }
      ];

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      });

      if (!response.ok) throw new Error('Chat failed');
      
      const data = await response.json();
      setChatMessages([...newMessages, { role: 'model' as const, content: data.text }]);
    } catch (error) {
      console.error("Chat failed:", error);
      setChatMessages([...newMessages, { role: 'model' as const, content: t.chatError }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const intensityToValue = (intensity: PainIntensity) => {
    switch (intensity) {
      case PainIntensity.LOW: return 1;
      case PainIntensity.MEDIUM: return 2;
      case PainIntensity.HIGH: return 3;
      default: return 0;
    }
  };

  const translateLocation = (loc: string) => {
    const zhLocs = translations.zh.locations;
    const enLocs = translations.en.locations;
    const index = zhLocs.indexOf(loc);
    if (index !== -1) return t.locations[index];
    const enIndex = enLocs.indexOf(loc);
    if (enIndex !== -1) return t.locations[enIndex];
    return loc;
  };

  const translateConstitution = (type: string) => {
    if (!type) return t.pendingAnalysis;
    const zhTypes = translations.zh.constitutionTypes;
    const enTypes = translations.en.constitutionTypes;
    const index = zhTypes.indexOf(type);
    if (index !== -1) return t.constitutionTypes[index];
    const enIndex = enTypes.indexOf(type);
    if (enIndex !== -1) return t.constitutionTypes[enIndex];
    return type;
  };

  const chartData = [...painRecords]
    .reverse()
    .slice(-7)
    .map(r => ({
      date: new Date(r.date).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }),
      intensity: intensityToValue(r.intensity),
      location: r.location
    }));

  const PainCalendar = () => {
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const days = [];
    // Fill empty days before start of month
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(null);
    }
    // Fill actual days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    const getPainForDay = (day: number) => {
      return painRecords.filter(r => {
        const d = new Date(r.date);
        return d.getDate() === day && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      });
    };

    return (
      <div className="w-full">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {t.weekDays.map(wd => (
            <div key={wd} className="text-[10px] text-gray-400 font-bold text-center uppercase">{wd}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} className="h-8" />;
            
            const records = getPainForDay(day);
            const maxIntensity = records.length > 0 
              ? Math.max(...records.map(r => intensityToValue(r.intensity)))
              : 0;
            
            const isToday = day === today.getDate();

            return (
              <div 
                key={day} 
                className={cn(
                  "h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all relative",
                  maxIntensity === 3 ? "bg-red-500 text-white" :
                  maxIntensity === 2 ? "bg-orange-400 text-white" :
                  maxIntensity === 1 ? "bg-green-400 text-white" :
                  "bg-gray-50 text-gray-400",
                  isToday && "ring-2 ring-[#5A5A40] ring-offset-1"
                )}
                title={records.length > 0 ? t.recordsCount.replace('{n}', records.length.toString()) : ""}
              >
                {day}
                {records.length > 1 && (
                  <span className="absolute top-0.5 right-0.5 w-1 h-1 bg-white rounded-full" />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-center gap-4 text-[10px] text-gray-400 font-medium">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-400" /> {t.intensities.Low}
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-orange-400" /> {t.intensities.Medium}
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-red-500" /> {t.intensities.High}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] font-serif">
      {/* Auth State Overlay */}
      <AnimatePresence>
        {isAuthLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-[#F5F2ED]"
          >
            <Loader2 className="animate-spin text-[#5A5A40]" size={40} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Login Screen */}
      {!user && !isAuthLoading && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-[#F5F2ED] p-4">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-8 rounded-[2rem] shadow-xl max-w-md w-full text-center space-y-6"
          >
            <div className="w-16 h-16 bg-[#5A5A40] rounded-full flex items-center justify-center text-white mx-auto">
              <Leaf size={32} />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-[#5A5A40]">{t.appName}</h1>
              <p className="text-gray-500 text-sm">{t.pleaseLogin}</p>
            </div>
            <button 
              onClick={signInWithGoogle}
              className="w-full py-4 px-6 bg-white border-2 border-gray-100 rounded-2xl flex items-center justify-center gap-3 font-bold hover:bg-gray-50 transition-all active:scale-95 shadow-sm"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
              {t.signInWithGoogle}
            </button>
          </motion.div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-[#1A1A1A]/10 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[#5A5A40] rounded-full flex items-center justify-center text-white">
                <Leaf size={18} />
              </div>
              <h1 className="text-xl font-semibold tracking-tight hidden sm:block">{t.appName}</h1>
            </div>
            
            {/* Language Switcher */}
            <div className="flex bg-gray-100 p-1 rounded-full">
              <button 
                onClick={() => setLang('zh')}
                className={cn(
                  "px-3 py-0.5 rounded-full text-[10px] font-bold transition-all",
                  lang === 'zh' ? "bg-white text-[#5A5A40] shadow-sm" : "text-gray-400"
                )}
              >
                {t.langZh}
              </button>
              <button 
                onClick={() => setLang('en')}
                className={cn(
                  "px-3 py-0.5 rounded-full text-[10px] font-bold transition-all",
                  lang === 'en' ? "bg-white text-[#5A5A40] shadow-sm" : "text-gray-400"
                )}
              >
                {t.langEn}
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            {user && (
              <div className="hidden md:flex items-center gap-2 mr-2">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="w-6 h-6 rounded-full border border-gray-200" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px]">
                    {user.displayName?.charAt(0)}
                  </div>
                )}
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">{t.welcome}</span>
              </div>
            )}
            
            <button 
              onClick={runAnalysis}
              disabled={isAnalyzing || (painRecords.length === 0 && reports.length === 0)}
              className={cn(
                "px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all flex items-center gap-2 relative",
                (isAnalyzing || (painRecords.length === 0 && reports.length === 0)) 
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed" 
                  : "bg-[#5A5A40] text-white hover:bg-[#4A4A30] shadow-sm active:scale-95",
                hasNewData && !isAnalyzing && "animate-pulse-subtle"
              )}
              title={painRecords.length === 0 && reports.length === 0 ? t.addRecordOrReport : ""}
            >
              {isAnalyzing ? <Loader2 className="animate-spin" size={16} /> : <Activity size={16} />}
              <span className="hidden sm:inline">{isAnalyzing ? t.analyzing : t.startAnalysis}</span>
              
              {hasNewData && !isAnalyzing && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
              )}
            </button>

            {user && (
              <button 
                onClick={logout}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
                title={t.logout}
              >
                <X size={20} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 pb-24">
        {/* Navigation Tabs */}
        <div className="flex gap-6 mb-8 border-b border-[#1A1A1A]/10 overflow-x-auto no-scrollbar">
          {[
            { id: 'dashboard', label: t.dashboard, icon: PieChart },
            { id: 'records', label: t.records, icon: History },
            { id: 'reports', label: t.reports, icon: FileText },
            { id: 'analysis', label: t.analysis, icon: Leaf },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "flex items-center gap-2 pb-3 text-sm font-medium transition-all relative whitespace-nowrap",
                activeTab === tab.id ? "text-[#5A5A40]" : "text-gray-400 hover:text-gray-600"
              )}
            >
              <tab.icon size={16} />
              {tab.label}
              {activeTab === tab.id && (
                <motion.div 
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#5A5A40]" 
                />
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-[#1A1A1A]/5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">{t.currentConstitution}</h3>
                    <Info size={16} className="text-gray-300" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-[#5A5A40]">
                      {translateConstitution(analysis?.constitutionType || '')}
                    </span>
                    <span className="text-xs text-gray-400">{t.basedOnRecent}</span>
                  </div>
                  {analysis && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {analysis.characteristics.map((c, i) => (
                        <span key={i} className="px-2 py-1 bg-[#F5F2ED] text-[#5A5A40] text-[10px] rounded-md uppercase tracking-wide font-bold">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white p-6 rounded-3xl shadow-sm border border-[#1A1A1A]/5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">{t.painTrend}</h3>
                    <Activity size={16} className="text-gray-300" />
                  </div>
                  <div className="w-full">
                    {painRecords.length > 0 ? (
                      <PainCalendar />
                    ) : (
                      <div className="h-24 flex items-center justify-center text-gray-300 text-xs italic">
                        {t.noTrendData}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-[#5A5A40] p-8 rounded-3xl text-white relative overflow-hidden">
                <div className="relative z-10">
                  <h2 className="text-2xl font-bold mb-2">{t.recordToday}</h2>
                  <p className="text-white/70 text-sm mb-6 max-w-md">
                    {t.recordDesc}
                  </p>
                  <button 
                    onClick={() => { setShowPainForm(true); setActiveTab('records'); }}
                    className="bg-white text-[#5A5A40] px-6 py-2 rounded-full text-sm font-bold hover:bg-gray-100 transition-colors flex items-center gap-2"
                  >
                    <Plus size={18} />
                    {t.recordNow}
                  </button>
                </div>
                <div className="absolute top-0 right-0 -mr-12 -mt-12 w-64 h-64 bg-white/5 rounded-full blur-3xl" />
              </div>

              {/* Recent Activity */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <History size={20} className="text-[#5A5A40]" />
                  {t.recentActivity}
                </h3>
                {painRecords.slice(0, 3).map((record) => (
                  <div key={record.id} className="bg-white p-4 rounded-2xl flex items-center justify-between border border-[#1A1A1A]/5">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center",
                        record.intensity === PainIntensity.HIGH ? "bg-red-50 text-red-500" :
                        record.intensity === PainIntensity.MEDIUM ? "bg-orange-50 text-orange-500" :
                        "bg-green-50 text-green-500"
                      )}>
                        <Activity size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm">{translateLocation(record.location)} - {t.intensities[record.intensity as unknown as keyof typeof t.intensities] || record.intensity}</h4>
                        <p className="text-xs text-gray-400">{new Date(record.date).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-gray-300" />
                  </div>
                ))}
                {painRecords.length === 0 && (
                  <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-gray-200">
                    <p className="text-gray-400 text-sm italic">{t.noRecords}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'records' && (
            <motion.div 
              key="records"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">{t.painLog}</h2>
                <button 
                  onClick={() => setShowPainForm(!showPainForm)}
                  className="bg-[#5A5A40] text-white p-2 rounded-full hover:bg-[#4A4A30] transition-colors"
                >
                  <Plus size={20} />
                </button>
              </div>

              {showPainForm && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="bg-white p-6 rounded-3xl shadow-sm border border-[#1A1A1A]/5 overflow-hidden"
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2">{t.painLocation}</label>
                      <div className="grid grid-cols-3 gap-2">
                        {t.locations.map((loc, idx) => (
                          <button
                            key={loc}
                            onClick={() => setNewPain({...newPain, location: loc})}
                            className={cn(
                              "py-2 text-xs rounded-xl border transition-all",
                              newPain.location === loc ? "bg-[#5A5A40] text-white border-[#5A5A40]" : "bg-white text-gray-600 border-gray-200 hover:border-[#5A5A40]"
                            )}
                          >
                            {loc}
                          </button>
                        ))}
                      </div>
                      {(newPain.location === translations.zh.locations[translations.zh.locations.length - 1] || 
                        newPain.location === translations.en.locations[translations.en.locations.length - 1]) && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-2"
                        >
                          <input 
                            type="text"
                            value={customLocation}
                            onChange={(e) => setCustomLocation(e.target.value)}
                            placeholder={lang === 'zh' ? "请输入疼痛部位/类型" : "Enter pain location/type"}
                            className="w-full p-3 bg-[#F5F2ED] rounded-xl border-none focus:ring-2 focus:ring-[#5A5A40] text-sm"
                          />
                        </motion.div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2">{t.intensity}</label>
                      <div className="flex gap-2">
                        {[PainIntensity.LOW, PainIntensity.MEDIUM, PainIntensity.HIGH].map(intensity => (
                          <button
                            key={intensity}
                            onClick={() => setNewPain({...newPain, intensity})}
                            className={cn(
                              "flex-1 py-2 text-xs rounded-xl border transition-all",
                              newPain.intensity === intensity ? "bg-[#5A5A40] text-white border-[#5A5A40]" : "bg-white text-gray-600 border-gray-200 hover:border-[#5A5A40]"
                            )}
                          >
                            {t.intensities[intensity as unknown as keyof typeof t.intensities]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2">{t.description}</label>
                      <textarea 
                        value={newPain.description}
                        onChange={(e) => setNewPain({...newPain, description: e.target.value})}
                        placeholder={t.descPlaceholder}
                        className="w-full p-4 bg-[#F5F2ED] rounded-2xl border-none focus:ring-2 focus:ring-[#5A5A40] text-sm min-h-[100px]"
                      />
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button 
                        onClick={addPainRecord}
                        className="flex-1 bg-[#5A5A40] text-white py-3 rounded-2xl font-bold text-sm hover:bg-[#4A4A30]"
                      >
                        {t.save}
                      </button>
                      <button 
                        onClick={() => setShowPainForm(false)}
                        className="px-6 py-3 rounded-2xl font-bold text-sm text-gray-400 hover:bg-gray-100"
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              <div className="space-y-4">
                {painRecords.map((record) => (
                  <div key={record.id} className="bg-white p-6 rounded-3xl shadow-sm border border-[#1A1A1A]/5 group">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center",
                          record.intensity === PainIntensity.HIGH ? "bg-red-50 text-red-500" :
                          record.intensity === PainIntensity.MEDIUM ? "bg-orange-50 text-orange-500" :
                          "bg-green-50 text-green-500"
                        )}>
                          <Activity size={24} />
                        </div>
                        <div>
                          <h3 className="font-bold text-lg">{translateLocation(record.location)}</h3>
                          <p className="text-xs text-gray-400">{new Date(record.date).toLocaleString()}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteRecord(record.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors p-2 opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                        record.intensity === PainIntensity.HIGH ? "bg-red-100 text-red-600" :
                        record.intensity === PainIntensity.MEDIUM ? "bg-orange-100 text-orange-600" :
                        "bg-green-100 text-green-600"
                      )}>
                        {t.intensities[record.intensity as unknown as keyof typeof t.intensities] || record.intensity}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {record.description || t.noDescription}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'reports' && (
            <motion.div 
              key="reports"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">{t.reports}</h2>
                <label className="bg-[#5A5A40] text-white p-2 rounded-full hover:bg-[#4A4A30] transition-colors cursor-pointer">
                  <Upload size={20} />
                  <input type="file" className="hidden" onChange={handleFileUpload} accept="image/*,.pdf" />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reports.map((report) => (
                  <div 
                    key={report.id} 
                    className="bg-white p-6 rounded-3xl shadow-sm border border-[#1A1A1A]/5 flex flex-col justify-between hover:border-[#5A5A40] transition-colors cursor-pointer group"
                    onClick={() => setSelectedReport(report)}
                  >
                    <div>
                      <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
                        <FileText size={24} />
                      </div>
                      <h3 className="font-bold text-sm mb-1 truncate">{report.name}</h3>
                      <p className="text-xs text-gray-400 mb-4">{t.uploadedAt} {new Date(report.uploadDate).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2 text-[#5A5A40] text-xs font-bold hover:underline">
                      {t.viewDetails} <ChevronRight size={14} />
                    </div>
                  </div>
                ))}
                
                <label className="border-2 border-dashed border-gray-200 rounded-3xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-[#5A5A40] transition-colors bg-white/50">
                  <Upload size={32} className="text-gray-300 mb-4" />
                  <p className="text-sm font-bold text-gray-400">{t.clickToUpload}</p>
                  <p className="text-xs text-gray-300 mt-1">{t.supportFormat}</p>
                  <input type="file" className="hidden" onChange={handleFileUpload} accept="image/*,.pdf" />
                </label>
              </div>

              <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100 flex gap-4">
                <Info className="text-blue-500 shrink-0" size={20} />
                <div>
                  <h4 className="text-sm font-bold text-blue-900 mb-1">{t.whyUpload}</h4>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    {t.whyUploadDesc}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'analysis' && (
            <motion.div 
              key="analysis"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-8"
            >
              {!analysis ? (
                <div className="text-center py-20 bg-white rounded-3xl border border-[#1A1A1A]/5">
                  <div className="w-20 h-20 bg-[#F5F2ED] rounded-full flex items-center justify-center mx-auto mb-6">
                    <Leaf size={40} className="text-[#5A5A40]" />
                  </div>
                  <h2 className="text-2xl font-bold mb-2">{t.noAnalysisYet}</h2>
                  <p className="text-gray-400 text-sm mb-8 max-w-xs mx-auto">
                    {t.noAnalysisDesc}
                  </p>
                  <button 
                    onClick={runAnalysis}
                    disabled={painRecords.length === 0 && reports.length === 0}
                    className="bg-[#5A5A40] text-white px-8 py-3 rounded-full font-bold text-sm hover:bg-[#4A4A30] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t.analyzeNow}
                  </button>
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Constitution Header */}
                  <div className="text-center space-y-4">
                    <span className="text-xs font-bold text-[#5A5A40] uppercase tracking-[0.2em]">{t.yourConstitutionIs}</span>
                    <h2 className="text-5xl font-black text-[#5A5A40]">{translateConstitution(analysis.constitutionType)}</h2>
                    <div className="flex justify-center gap-2">
                      {analysis.characteristics.map((c, i) => (
                        <span key={i} className="px-3 py-1 bg-white rounded-full text-xs font-medium border border-[#1A1A1A]/5 shadow-sm">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Detailed Analysis */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 space-y-6">
                      <section className="bg-white p-8 rounded-[2rem] shadow-sm border border-[#1A1A1A]/5">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                          <Activity size={20} className="text-[#5A5A40]" />
                          {t.pathologyAnalysis}
                        </h3>
                        <p className="text-gray-600 leading-relaxed text-sm">
                          {analysis.painAnalysis}
                        </p>
                      </section>

                      <section className="bg-white p-8 rounded-[2rem] shadow-sm border border-[#1A1A1A]/5">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                          <Leaf size={20} className="text-[#5A5A40]" />
                          {t.dietaryPlan}
                        </h3>
                        <p className="text-gray-600 leading-relaxed text-sm italic mb-6">
                          {analysis.herbalSuggestions}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {analysis.dietaryAdvice.map((item, i) => (
                            <div key={i} className="flex gap-3 items-start p-3 bg-[#F5F2ED] rounded-2xl">
                              <Utensils size={16} className="text-[#5A5A40] shrink-0 mt-1" />
                              <span className="text-xs font-medium">{item}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>

                    <div className="space-y-6">
                      <section className="bg-[#5A5A40] p-8 rounded-[2rem] text-white">
                        <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                          <Sun size={20} />
                          {t.lifestyleAdvice}
                        </h3>
                        <ul className="space-y-4">
                          {analysis.lifestyleAdvice.map((item, i) => (
                            <li key={i} className="flex gap-3 items-start text-sm">
                              <CheckCircle2 size={16} className="text-white/50 shrink-0 mt-1" />
                              <span className="text-white/90">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </section>

                      <div className="bg-orange-50 p-6 rounded-[2rem] border border-orange-100">
                        <div className="flex items-center gap-2 text-orange-600 mb-2">
                          <AlertCircle size={18} />
                          <h4 className="text-sm font-bold">{t.disclaimer}</h4>
                        </div>
                        <p className="text-[10px] text-orange-800 leading-relaxed">
                          {t.disclaimerText}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* AI Chat Section */}
                  <section className="bg-white rounded-[2rem] shadow-sm border border-[#1A1A1A]/5 overflow-hidden flex flex-col md:flex-row">
                    <div className="md:w-1/3 bg-[#5A5A40] p-8 text-white flex flex-col justify-between">
                      <div>
                        <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-6">
                          <MessageSquare size={24} />
                        </div>
                        <h3 className="text-xl font-bold mb-2">{t.chatTitle}</h3>
                        <p className="text-white/70 text-sm leading-relaxed">
                          {t.chatSubtitle}
                        </p>
                      </div>
                      <div className="mt-8 pt-8 border-t border-white/10">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center overflow-hidden">
                            <Leaf size={20} className="text-white" />
                          </div>
                          <div>
                            <p className="text-xs font-bold">{t.aiExpert}</p>
                            <p className="text-[10px] text-white/50">{t.onlineStatus}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex-1 flex flex-col h-[500px] bg-gray-50/50">
                      <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar">
                        {/* Welcome Message */}
                        <div className="flex justify-start">
                          <div className="max-w-[85%] bg-white p-4 rounded-2xl rounded-tl-none shadow-sm border border-gray-100">
                            <p className="text-sm text-gray-600 leading-relaxed">
                              {t.chatWelcome}
                            </p>
                          </div>
                        </div>

                        {chatMessages.map((msg, i) => (
                          <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                            <div className={cn(
                              "max-w-[85%] p-4 rounded-2xl shadow-sm",
                              msg.role === 'user' 
                                ? "bg-[#5A5A40] text-white rounded-tr-none" 
                                : "bg-white text-gray-600 rounded-tl-none border border-gray-100"
                            )}>
                              <div className="text-sm leading-relaxed markdown-body">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        ))}
                        
                        {isChatLoading && (
                          <div className="flex justify-start">
                            <div className="bg-white p-4 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 flex items-center gap-2">
                              <Loader2 size={14} className="animate-spin text-[#5A5A40]" />
                              <span className="text-xs text-gray-400">{t.chatLoading}</span>
                            </div>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>

                      <div className="p-4 bg-white border-t border-gray-100">
                        <div className="relative">
                          <input 
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                            placeholder={t.chatPlaceholder}
                            className="w-full pl-4 pr-12 py-3 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-[#5A5A40] text-sm"
                          />
                          <button 
                            onClick={handleSendMessage}
                            disabled={!chatInput.trim() || isChatLoading}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[#5A5A40] hover:bg-[#5A5A40]/10 rounded-lg transition-colors disabled:opacity-30"
                          >
                            <Send size={20} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation (Mobile Friendly) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-[#1A1A1A]/5 p-4 md:hidden">
        <div className="flex justify-around items-center max-w-md mx-auto">
          <button onClick={() => setActiveTab('dashboard')} className={cn("p-2 rounded-xl", activeTab === 'dashboard' ? "text-[#5A5A40] bg-[#F5F2ED]" : "text-gray-400")}>
            <PieChart size={24} />
          </button>
          <button onClick={() => setActiveTab('records')} className={cn("p-2 rounded-xl", activeTab === 'records' ? "text-[#5A5A40] bg-[#F5F2ED]" : "text-gray-400")}>
            <History size={24} />
          </button>
          <button onClick={() => setActiveTab('reports')} className={cn("p-2 rounded-xl", activeTab === 'reports' ? "text-[#5A5A40] bg-[#F5F2ED]" : "text-gray-400")}>
            <FileText size={24} />
          </button>
          <button onClick={() => setActiveTab('analysis')} className={cn("p-2 rounded-xl", activeTab === 'analysis' ? "text-[#5A5A40] bg-[#F5F2ED]" : "text-gray-400")}>
            <Leaf size={24} />
          </button>
        </div>
      </div>

      {/* Report Detail Modal */}
      <AnimatePresence>
        {selectedReport && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedReport(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-[2rem] w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg">{selectedReport.name}</h3>
                  <p className="text-xs text-gray-400">{t.uploadedAt} {new Date(selectedReport.uploadDate).toLocaleString()}</p>
                </div>
                <button 
                  onClick={() => setSelectedReport(null)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-6 bg-gray-50 flex items-center justify-center relative">
                {selectedReport.type === 'image' ? (
                  <img 
                    src={selectedReport.content} 
                    alt={selectedReport.name} 
                    className="max-w-full h-auto rounded-lg shadow-sm"
                    referrerPolicy="no-referrer"
                  />
                ) : selectedReport.type === 'pdf' ? (
                  <div className="w-full h-full flex flex-col items-center">
                    <object
                      data={selectedReport.content}
                      type="application/pdf"
                      className="w-full h-full min-h-[60vh] rounded-lg shadow-sm"
                    >
                      <div className="text-center p-12 bg-white rounded-2xl border border-gray-200">
                        <FileText size={48} className="mx-auto text-gray-300 mb-4" />
                        <p className="text-gray-600 mb-4">{t.browserNoPdf}</p>
                        <a 
                          href={selectedReport.content} 
                          download={selectedReport.name}
                          className="inline-flex items-center gap-2 px-6 py-2 bg-[#5A5A40] text-white rounded-full text-sm font-bold"
                        >
                          {t.downloadToView}
                        </a>
                      </div>
                    </object>
                  </div>
                ) : (
                  <div className="text-center p-12">
                    <FileText size={48} className="mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500">{t.unsupportedPreview}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Analysis Loading Overlay */}
      <AnimatePresence>
        {isAnalyzing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-[#F5F2ED]/90 backdrop-blur-md"
          >
            <div className="relative mb-8">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="w-24 h-24 border-2 border-dashed border-[#5A5A40] rounded-full"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Leaf className="text-[#5A5A40] animate-pulse" size={32} />
              </div>
            </div>
            <motion.p 
              key={loadingMessage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-[#5A5A40] font-bold text-lg tracking-wide"
            >
              {loadingMessage}
            </motion.p>
            <p className="text-gray-400 text-xs mt-4 italic">{t.loadingWait}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
