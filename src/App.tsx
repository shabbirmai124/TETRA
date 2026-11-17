/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ColorMode, DEFAULT_OPTIONS, Edition, GameOptions, ScreenState } from './types/game';
import { TitleScreen } from './components/TitleScreen';
import { PauseModal, EndModal } from './components/Modals';
import { NoColorGame } from '../no-color/NoColorGame';
import { ColorGame } from '../color/ColorGame';
import { NoColorSnapshot } from '../no-color/engine';
import { ColorSnapshot } from '../color/engine';
import { soundSynth } from './audio/synth';

const OPTIONS_STORAGE_KEY = 'tetra_options_v1';

const loadOptions = (): GameOptions => {
  try {
    const raw = localStorage.getItem(OPTIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_OPTIONS;
    return { ...DEFAULT_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_OPTIONS;
  }
};

export default function App() {
  const [edition, setEdition] = useState<Edition>(() => {
    const params = new URLSearchParams(window.location.search);
    const ed = params.get('edition');
    return ed === 'no-color' ? 'no-color' : 'color';
  });

  const [colorMode, setColorMode] = useState<ColorMode>('marathon');

  const [screen, setScreen] = useState<ScreenState>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') === '1' ? 'playing' : 'title';
  });

  const [runNonce, setRunNonce] = useState<number>(1);
  const [options, setOptions] = useState<GameOptions>(loadOptions);
  const [noColorResult, setNoColorResult] = useState<NoColorSnapshot | null>(null);
  const [colorResult, setColorResult] = useState<ColorSnapshot | null>(null);

  // Mirror game state to document.body.dataset.state
  useEffect(() => {
    document.body.dataset.state = screen;
  }, [screen]);

  // Keep Web Audio synth mute state synced
  useEffect(() => {
    soundSynth.setMuted(!options.soundEnabled);
  }, [options.soundEnabled]);

  const updateOptions = useCallback((patch: Partial<GameOptions>) => {
    setOptions((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failure
      }
      return next;
    });
  }, []);

  const handleStart = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setNoColorResult(null);
    setColorResult(null);
    setRunNonce((n) => n + 1);
    document.body.dataset.state = 'playing';
    setScreen('playing');
  }, []);

  const handlePause = useCallback(() => {
    setScreen((curr) => (curr === 'playing' ? 'paused' : curr));
  }, []);

  const handleResume = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setScreen('playing');
  }, []);

  const handleRestart = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setNoColorResult(null);
    setColorResult(null);
    setRunNonce((n) => n + 1);
    setScreen('playing');
  }, []);

  const handleQuitToTitle = useCallback(() => {
    setNoColorResult(null);
    setColorResult(null);
    setScreen('title');
  }, []);

  const handleNoColorGameOver = useCallback((snap: NoColorSnapshot) => {
    setNoColorResult(snap);
    setScreen('gameover');
  }, []);

  const handleColorFinish = useCallback((snap: ColorSnapshot) => {
    setColorResult(snap);
    setScreen('gameover');
  }, []);

  const handleToggleSound = useCallback(() => {
    updateOptions({ soundEnabled: !options.soundEnabled });
  }, [options.soundEnabled, updateOptions]);

  // Allow Esc/P to resume when paused
  useEffect(() => {
    if (screen !== 'paused') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        handleResume();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, handleResume]);

  return (
    <div className="h-screen w-screen overflow-hidden">
      {screen === 'title' ? (
        <TitleScreen
          edition={edition}
          colorMode={colorMode}
          onSelectEdition={setEdition}
          onSelectColorMode={setColorMode}
          onStart={handleStart}
        />
      ) : edition === 'no-color' ? (
        <NoColorGame
          screen={screen}
          runNonce={runNonce}
          options={options}
          onPause={handlePause}
          onGameOver={handleNoColorGameOver}
          onToggleSound={handleToggleSound}
        />
      ) : (
        <ColorGame
          mode={colorMode}
          screen={screen}
          runNonce={runNonce}
          options={options}
          onPause={handlePause}
          onFinish={handleColorFinish}
          onToggleSound={handleToggleSound}
        />
      )}

      {screen === 'paused' && (
        <PauseModal
          edition={edition}
          options={options}
          onUpdateOptions={updateOptions}
          onResume={handleResume}
          onRestart={handleRestart}
          onQuit={handleQuitToTitle}
        />
      )}

      {screen === 'gameover' && (
        <EndModal
          edition={edition}
          noColorResult={noColorResult}
          colorResult={colorResult}
          onPlayAgain={handleRestart}
          onTitle={handleQuitToTitle}
        />
      )}
    </div>
  );
}
