import { useRef, useState, useCallback } from 'react';
import { p } from '../config/personalization';

// Browser built-in speech synthesis — works on every PC without install
export function browserSpeak(text: string, rate = p.voice.rate, pitch = p.voice.pitch): void {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = rate;
  utt.pitch = pitch;
  utt.volume = 1;

  // Prefer a deep male English voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.lang.startsWith('en') && (v.name.includes('David') || v.name.includes('Mark') || v.name.includes('Male') || v.name.includes('Guy'))
  ) ?? voices.find(v => v.lang.startsWith('en')) ?? voices[0];
  if (preferred) utt.voice = preferred;

  window.speechSynthesis.speak(utt);
}

// Startup greeting — called once when app loads
export function playStartupGreeting(): void {
  const speak = () => browserSpeak(p.voice.greeting);
  if (window.speechSynthesis.getVoices().length > 0) {
    speak();
  } else {
    window.speechSynthesis.onvoiceschanged = speak;
  }
}

// Speech recognition hook — mic button
export function useSpeechInput(onResult: (text: string) => void) {
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

    if (!SR) {
      alert('Speech recognition is not supported in this browser. Use Chrome or Edge.');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SR();
    recognition.lang = 'nl-NL'; // Dutch — change to 'en-US' for English only
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      onResult(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error('[SPEECH]', event.error);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
  }, [onResult]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  return { isListening, toggleListening };
}
