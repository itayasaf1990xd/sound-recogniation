import { motion } from 'framer-motion';
import { FC, useEffect, useRef, useState } from 'react';

// מאפשר גישה ל-SpeechRecognition אם קיימת בדפדפן
declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  }
}

const VoiceRecognitionApp: FC = () => {
  const [listening, setListening] = useState<boolean>(false);
  const [decibels, setDecibels] = useState<number>(0);
  const [volumeStatus, setVolumeStatus] = useState<string>('');
  const [transcript, setTranscript] = useState<string>('');

  // ערך הדציבלים החלק (מחולק כדי למנוע ריצודים)
  const smoothDbRef = useRef<number>(-100);

  // הפניות ל-Web Audio API
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // הפניה ל-SpeechRecognition
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // בדיקה אם ה-API לזיהוי דיבור קיים בדפדפן
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.lang = 'he-IL';
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.onresult = (event: any) => {
        const current = event.resultIndex;
        const transcriptRes = event.results[current][0].transcript;
        setTranscript(transcriptRes);
      };
      recognitionRef.current = recognition;
    }
  }, []);

  const startListening = async () => {
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (!analyserRef.current || !audioContextRef.current) {
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 512; // גודל FFT - נקודות דגימה
      }

      if (!sourceRef.current && audioContextRef.current) {
        sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
        sourceRef.current.connect(analyserRef.current);
      }

      dataArrayRef.current = new Uint8Array(analyserRef.current.fftSize);

      if (recognitionRef.current) {
        recognitionRef.current.start();
      }

      setListening(true);
      updateDecibels();
    } catch (err) {
      console.error('Microphone access denied or error:', err);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setListening(false);

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    sourceRef.current = null;
    dataArrayRef.current = null;

    // איפוס
    setTranscript('');
    setDecibels(0);
    setVolumeStatus('');
    smoothDbRef.current = -100;
  };

  const updateDecibels = () => {
    if (analyserRef.current && dataArrayRef.current) {
      analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
      // חישוב RMS (Root Mean Square)
      let sum = 0;
      for (let i = 0; i < dataArrayRef.current.length; i++) {
        const val = (dataArrayRef.current[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArrayRef.current.length);
      // המרת RMS לדציבלים (לוג10)
      let db = 20 * Math.log10(rms);

      // אם הערך נמוך במיוחד, נגדיר לו מינימום ("רעש רקע")
      if (db < -100) {
        db = -100;
      }

      // שימוש בסינון (Smoothing) קל כדי לצמצם ריצודים מהירים
      const smoothingFactor = 0.8; // ערך קרוב ל-1 = החלקה חזקה יותר
      smoothDbRef.current =
        smoothingFactor * smoothDbRef.current + (1 - smoothingFactor) * db;

      const dbSmoothed = smoothDbRef.current;
      setDecibels(dbSmoothed);

      // הגדרת סטטוס (חלש/תקין/חזק) לפי ספים מותאמים
      let status = '';
      // > -35 => חזק מידי
      // -35 עד -55 => בטווח תקין
      // < -55 => חלש מידי
      if (dbSmoothed > -35) {
        status = 'חזק מידי';
      } else if (dbSmoothed < -55) {
        status = 'חלש מידי';
      } else {
        status = 'בטווח תקין';
      }
      setVolumeStatus(status);

      rafIdRef.current = requestAnimationFrame(updateDecibels);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-gray-50">
      <motion.h1
        className="text-2xl font-bold mb-4"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        מד דציבלים וזיהוי דיבור (TypeScript)
      </motion.h1>
      <motion.div
        className="max-w-sm w-full rounded-2xl shadow-lg bg-white p-4 mb-4"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex flex-col items-center justify-center space-y-4">
          <span className="text-xl">דציבלים: {decibels.toFixed(2)}</span>
          <span className="text-xl">סטטוס עוצמה: {volumeStatus}</span>
          <span className="text-md">תמלול: {transcript}</span>
        </div>
      </motion.div>

      <motion.div
        className="flex space-x-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        {!listening ? (
          <button
            onClick={startListening}
            className="bg-blue-500 text-white px-4 py-2 rounded-2xl shadow-md hover:bg-blue-600"
          >
            התחל
          </button>
        ) : (
          <button
            onClick={stopListening}
            className="bg-red-500 text-white px-4 py-2 rounded-2xl shadow-md hover:bg-red-600"
          >
            עצור
          </button>
        )}
      </motion.div>
    </div>
  );
};

export default VoiceRecognitionApp;
