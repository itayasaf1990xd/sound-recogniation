import { motion } from 'framer-motion';
import React, { FC, useEffect, useRef, useState } from 'react';
import './VolumControllApp.css';
// אייקונים
import { Mic, VolumeX } from 'lucide-react';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    webkitSpeechRecognition?: any;
    SpeechRecognition?: any;
  }
}

interface ISpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (event: any) => void;
  start: () => void;
  stop: () => void;
}

interface CardProps {
  children: React.ReactNode;
  className?: string;
}
const Card: FC<CardProps> = ({ children, className = '' }) => (
  <div className={`bg-white rounded-2xl shadow-md p-6 ${className}`}>{children}</div>
);

interface CardContentProps {
  children: React.ReactNode;
  className?: string;
}
const CardContent: FC<CardContentProps> = ({ children, className = '' }) => (
  <div className={`flex flex-col gap-4 ${className}`}>{children}</div>
);

interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}
const Button: FC<ButtonProps> = ({ onClick, children, className = '' }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-md font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-colors ${className}`}
  >
    {children}
  </button>
);

interface SpeakerProfile {
  id: string;
  name: string;
  rms: number;
}

async function saveSignatureToBackend(signature: number): Promise<boolean> {
  console.log('שומר חתימת קול בבקנד...', signature);
  return true;
}

function generateId(): string {
  return 'SPK-' + Math.floor(Math.random() * 1000000);
}

const VolumControllApp: FC = (): JSX.Element => {
  // --- States & refs ---
  const [isRecording, setIsRecording] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [feedbackColor, setFeedbackColor] = useState('#4ade80');
  const [errorMessage, setErrorMessage] = useState('');
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // נשמור רעש רקע מחושב (baseline)
  const [backgroundRms, setBackgroundRms] = useState<number>(0);

  const [dB, setDB] = useState(0);

  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<ISpeechRecognition | null>(null);

  // אימון
  const [isTraining, setIsTraining] = useState(false);
  const [samplesCollected, setSamplesCollected] = useState<number[]>([]);
  const [speakerStatus, setSpeakerStatus] = useState('לא נמצא דובר ראשי');
  const [recognizedSpeakers, setRecognizedSpeakers] = useState<SpeakerProfile[]>([]);

  // חלונית להוספת דובר חדש
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [newSpeakerRms, setNewSpeakerRms] = useState<number | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState('');

  // === localStorage load/save ===
  useEffect(() => {
    const data = localStorage.getItem('speakers');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          setRecognizedSpeakers(parsed);
          console.log('Loaded speakers from localStorage:', parsed);
        }
      } catch (err) {
        console.error('Failed to parse speakers from localStorage', err);
      }
    }
  }, []);

  useEffect(() => {
    if (recognizedSpeakers.length > 0) {
      localStorage.setItem('speakers', JSON.stringify(recognizedSpeakers));
      console.log('Saved speakers to localStorage:', recognizedSpeakers);
    }
  }, [recognizedSpeakers]);
  // === end localStorage ===

  // הגדרת SpeechRecognition
  useEffect(() => {
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition: ISpeechRecognition = new SpeechRecognition();
      recognition.lang = 'he-IL';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: any) => {
        let newTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          newTranscript += event.results[i][0].transcript;
        }
        setTranscript(newTranscript);
      };
      recognitionRef.current = recognition;
    }
  }, []);

  // === calibration approach ===
  const calibrateNoise = async (durationMs = 1500) => {
    // נאסוף RMS למשך הזמן הזה
    const startTime = performance.now();
    let collected: number[] = [];

    return new Promise<number>((resolve) => {
      const measure = () => {
        if (!analyserRef.current || !dataArrayRef.current) {
          resolve(0);
          return;
        }
        analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          const val = dataArrayRef.current[i] - 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArrayRef.current.length);
        collected.push(rms);

        const now = performance.now();
        if (now - startTime >= durationMs) {
          // סיימנו
          const total = collected.reduce((acc, v) => acc + v, 0);
          const avgRms = total / collected.length;
          resolve(avgRms);
        } else {
          requestAnimationFrame(measure);
        }
      };
      measure();
    });
  };

  // לולאת המדידה (אבל את רעש הרקע מורידים!)
  useEffect(() => {
    let animationId: number | null = null;

    const updateVolume = () => {
      if (analyserRef.current && dataArrayRef.current) {
        analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          const val = dataArrayRef.current[i] - 128;
          sum += val * val;
        }
        let rmsRaw = Math.sqrt(sum / dataArrayRef.current.length);

        // מפחיתים את רעש הרקע (baseline)
        let rmsAdjusted = rmsRaw - backgroundRms;
        if (rmsAdjusted < 0) rmsAdjusted = 0; // שלא יהיה שלילי

        const normalized = rmsAdjusted / 128;
        let decibels = 20 * Math.log10(normalized);
        if (decibels < -100) decibels = -100; // רצפה

        setDB(Math.round(decibels));

        // נמפה -100..0 => 0..100
        const mappedLevel = Math.round(decibels + 100);
        setVolumeLevel(mappedLevel);

        // צבע
        if (mappedLevel < 20) {
          setFeedbackColor('#4ade80');
        } else if (mappedLevel < 40) {
          setFeedbackColor('#fde047');
        } else {
          setFeedbackColor('#f87171');
        }

        if (isTraining) {
          setSamplesCollected((prev) => [...prev, rmsRaw]);
        } else {
          // מזהים
          if (recognizedSpeakers.length > 0) {
            let bestMatch: SpeakerProfile | null = null;
            let bestDiff = Infinity;
            recognizedSpeakers.forEach((sp) => {
              // נשווה rmsRaw (לא adjusted!) אם תמיד אימנו בלי הפחתת רקע
              // או אם רוצים consistency מלא, אולי נאמן את adjusted. תלוי במה שעשינו בזמן האימון
              const diff = Math.abs(rmsRaw - sp.rms);
              if (diff < bestDiff) {
                bestDiff = diff;
                bestMatch = sp;
              }
            });
            if (bestDiff < 15 && bestMatch) {
              setSpeakerStatus(`זוהה דובר: ${bestMatch['name']}`);
            } else {
              setSpeakerStatus('לא נמצא דובר ראשי');
            }
          } else {
            setSpeakerStatus('לא נמצא דובר ראשי');
          }
        }
      }
      animationId = requestAnimationFrame(updateVolume);
    };

    if (isRecording) {
      updateVolume();
    } else if (animationId) {
      cancelAnimationFrame(animationId);
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [
    isRecording,
    backgroundRms, // בכל פעם שמשתנה baseline, יתעדכן
    isTraining,
    recognizedSpeakers,
  ]);

  // התחלת מדידה
  const startRecording = async () => {
    setErrorMessage('');
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      mediaStreamRef.current = stream;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      source.connect(analyser);

      const bufferLength = analyser.fftSize;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;

      setIsRecording(true);

      if (recognitionRef.current) {
        recognitionRef.current.start();
      }

      // כעת - הכיול
      const baseRms = await calibrateNoise(1500);
      setBackgroundRms(baseRms);
      console.log('Calibrated background RMS =', baseRms);
    } catch (err) {
      setErrorMessage('שגיאה: לא ניתן לגשת למיקרופון.');
      console.error(err);
    }
  };

  // עצירה
  const stopRecording = () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    analyserRef.current = null;
    dataArrayRef.current = null;
    setBackgroundRms(0); // אפסנו baseline (אופציונלי)
  };

  // אימון
  const trainSpeaker = async () => {
    if (isTraining) return;
    setSamplesCollected([]);
    setSpeakerStatus('מתבצע אימון דובר (5 שניות)...');

    if (!isRecording) {
      await startRecording();
      // מחכים עוד קצת כדי לסיים הכיול לפני האימון
      await new Promise((res) => setTimeout(res, 500));
    }

    setIsTraining(true);

    const startT = performance.now();
    const trainDuration = 5000;
    const checkTraining = () => {
      const elapsed = performance.now() - startT;
      if (elapsed >= trainDuration) {
        finalizeTraining();
      } else {
        setTimeout(checkTraining, 100);
      }
    };
    setTimeout(checkTraining, 100);
  };

  const finalizeTraining = async () => {
    setIsTraining(false);
    if (samplesCollected.length === 0) {
      setSpeakerStatus('לא נאספו דגימות קול – ייתכן שלא דיברת?');
      return;
    }
    const total = samplesCollected.reduce((acc, val) => acc + val, 0);
    const avg = total / samplesCollected.length;
    if (avg < 0.01) {
      setSpeakerStatus('הקול היה חלש מדי, או לא דיברת בכלל');
      return;
    }
    setNewSpeakerRms(avg);
    setShowNamePrompt(true);

    stopRecording(); // אופציונלי
  };

  const handleSaveNewSpeaker = async () => {
    if (newSpeakerRms == null || !newSpeakerName.trim()) {
      alert('חסר שם או RMS');
      return;
    }
    setSpeakerStatus('שומר חתימת קול בבקנד...');
    const success = await saveSignatureToBackend(newSpeakerRms);
    if (success) {
      const newSpeaker: SpeakerProfile = {
        id: generateId(),
        name: newSpeakerName.trim(),
        rms: newSpeakerRms,
      };
      setRecognizedSpeakers((prev) => [...prev, newSpeaker]);
      setSpeakerStatus(`דובר ראשי אומן ונשמר בהצלחה! (${newSpeaker.name})`);
    } else {
      setSpeakerStatus('שגיאה בשמירת הדובר בבקנד');
    }
    setShowNamePrompt(false);
    setNewSpeakerName('');
    setNewSpeakerRms(null);
  };

  const handleCancelNewSpeaker = () => {
    setShowNamePrompt(false);
    setNewSpeakerName('');
    setNewSpeakerRms(null);
    setSpeakerStatus('אימון בוטל / לא נשמר');
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-50 to-blue-100 flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">
        אפליקציית שליטה בעוצמת הקול + כיול רעש רקע
      </h1>
      <Card className="max-w-lg w-full">
        <CardContent>
          <div className="text-center mb-4">
            <p className="mb-2 text-gray-700">
              ישנו שלב כיול קצר בעת התחלת הקלטה (1.5 שניות), שבו מודדים את רעש הרקע ומפחיתים אותו מהמדידות.
            </p>
            <p className="text-sm text-gray-500">
              כך, בחדר שקט באמת, יופחתו ערכי -40 dB ויראו יותר נמוכים.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-center mb-4">
            {!isRecording && (
              <Button onClick={startRecording} className="flex items-center gap-2">
                <Mic size={18} />
                התחל מדידה
              </Button>
            )}
            {isRecording && (
              <Button
                onClick={stopRecording}
                className="flex items-center gap-2 bg-red-500 hover:bg-red-600"
              >
                <VolumeX size={18} />
                עצור
              </Button>
            )}
            <Button
              onClick={trainSpeaker}
              className={`flex items-center gap-2 ${
                isTraining ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600'
              }`}
            >
              <Mic size={18} />
              {isTraining ? 'אימון פעיל...' : 'בחר דובר ראשי (5 שניות)'}
            </Button>
          </div>

          {errorMessage && (
            <div className="text-red-600 text-center text-sm mb-4">
              {errorMessage}
            </div>
          )}

          <motion.div
            className="w-full h-24 flex flex-col items-center justify-center rounded-2xl shadow-md"
            animate={{ backgroundColor: feedbackColor }}
            transition={{ duration: 0.2 }}
          >
            <div className="text-3xl font-bold text-white">
              {isRecording ? `${dB} dB` : '—'}
            </div>
            <div className="text-sm text-white opacity-90">
              {isRecording ? 'עוצמת דיבור משוערת' : 'מצב לא פעיל'}
            </div>
          </motion.div>

          <div className="text-center mt-4">
            <p className="mb-1">
              <span className="font-bold">עוצמה נוכחית (0..100):</span> {volumeLevel}
            </p>
            <p className="text-sm text-gray-500">
              <span>ירוק = שקט, צהוב = בינוני, אדום = חזק</span>
            </p>
          </div>
        </CardContent>

        <div className="mt-4 text-center">
          <p className="text-lg font-semibold">מצב דובר:</p>
          <p
            className="text-md mt-2"
            style={{
              color: speakerStatus.includes('זוהה')
                ? 'green'
                : speakerStatus.includes('אומן') ||
                  speakerStatus.includes('שומר חתימת קול')
                ? 'blue'
                : 'red',
            }}
          >
            {speakerStatus}
          </p>
        </div>

        {recognizedSpeakers.length > 0 && (
          <div className="mt-4">
            <ul className="list-disc pl-4">
              {recognizedSpeakers.map((sp) => (
                <li key={sp.id}>
                  <span className="font-semibold">{sp.name}</span> (ID: {sp.id})
                  <span className="ml-2 text-sm text-gray-500">
                    [RMS = {sp.rms.toFixed(2)}]
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {isRecording && (
        <Card className="max-w-lg w-full mt-4">
          <CardContent>
            <h2 className="text-lg font-bold">תמלול בזמן אמת</h2>
            <p className="whitespace-pre-wrap text-gray-700">{transcript}</p>
          </CardContent>
        </Card>
      )}

      {showNamePrompt && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-md p-6 w-80 shadow-lg flex flex-col">
            <h3 className="text-xl font-bold mb-4">הכנס שם דובר</h3>
            <input
              type="text"
              value={newSpeakerName}
              onChange={(e) => setNewSpeakerName(e.target.value)}
              placeholder="למשל: יוסי, אריאל..."
              className="border border-gray-300 rounded-md p-2 mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button onClick={handleSaveNewSpeaker}>שמור</Button>
              <Button
                onClick={handleCancelNewSpeaker}
                className="bg-gray-400 hover:bg-gray-500"
              >
                ביטול
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VolumControllApp;
