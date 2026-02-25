import { useCallback, useEffect, useState } from "react";
import "./index.css";
import { fetchModelInfo } from "./api";
import type { ModelInfo } from "./api";
import CustomVoiceTab from "./components/CustomVoiceTab";
import VoiceDesignTab from "./components/VoiceDesignTab";
import VoiceCloneTab from "./components/VoiceCloneTab";
import NovelTTSTab from "./components/NovelTTSTab";
import ModelSelector from "./components/ModelSelector";

type TabId = "custom-voice" | "voice-design" | "voice-clone" | "novel-tts";

const TABS: { id: TabId; label: string; emoji: string; kind: string }[] = [
  { id: "custom-voice", label: "Custom Voice", emoji: "🎙️", kind: "custom_voice" },
  { id: "voice-design", label: "Voice Design", emoji: "🎨", kind: "voice_design" },
  { id: "voice-clone", label: "Voice Clone", emoji: "🎤", kind: "base" },
  { id: "novel-tts", label: "Novel TTS", emoji: "📖", kind: "custom_voice" },
];

const DEFAULT_LANGUAGES = [
  "Chinese", "English", "Japanese", "Korean",
  "German", "French", "Russian", "Portuguese", "Spanish", "Italian",
];

const DEFAULT_SPEAKERS = [
  "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric",
  "Ryan", "Aiden", "Ono_Anna", "Sohee",
];

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("custom-voice");
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [showModelPanel, setShowModelPanel] = useState(false);

  const refreshInfo = useCallback(() => {
    fetchModelInfo()
      .then((data) => {
        setInfo(data);
        setConnectionStatus("connected");
      })
      .catch(() => {
        setConnectionStatus("disconnected");
      });
  }, []);

  useEffect(() => {
    refreshInfo();
  }, [refreshInfo]);

  const languages = info?.supported_languages?.length
    ? info.supported_languages
    : DEFAULT_LANGUAGES;
  const speakers = info?.supported_speakers?.length
    ? info.supported_speakers
    : DEFAULT_SPEAKERS;
  const modelLoaded = info?.model_loaded ?? false;
  const modelKind = info?.model_kind ?? null;

  // Auto-switch tab to match loaded model kind
  const handleModelChanged = () => {
    refreshInfo();
    // After refresh, the info will update and we can switch tab
    fetchModelInfo().then((newInfo) => {
      setInfo(newInfo);
      if (newInfo.model_kind === "custom_voice") setActiveTab("custom-voice");
      else if (newInfo.model_kind === "voice_design") setActiveTab("voice-design");
      else if (newInfo.model_kind === "base") setActiveTab("voice-clone");
    }).catch(() => { });
  };

  // Check if current tab matches loaded model kind
  const currentTabMatchesModel = () => {
    if (!modelLoaded || !modelKind) return true; // allow all when no model
    const tab = TABS.find((t) => t.id === activeTab);
    return tab?.kind === modelKind;
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <h1>Qwen3-TTS</h1>
        <p className="subtitle">고품질 AI 음성 합성 — Custom Voice · Voice Design · Voice Clone</p>
        <button
          className="model-status"
          onClick={() => setShowModelPanel(!showModelPanel)}
          style={{ cursor: "pointer" }}
        >
          <span
            className={`dot ${connectionStatus === "connected"
              ? modelLoaded ? "connected" : "disconnected"
              : connectionStatus === "loading" ? "disconnected" : "error"
              }`}
          />
          {connectionStatus === "loading"
            ? "서버 연결 중..."
            : connectionStatus === "connected"
              ? modelLoaded
                ? `${info?.model_id?.split("/").pop() || ""}`
                : "모델 미로드 — 클릭하여 선택"
              : "서버 연결 실패"}
          <span style={{ marginLeft: 6, fontSize: "0.75rem" }}>
            {showModelPanel ? "▲" : "▼"}
          </span>
        </button>
      </header>

      {/* Model Selector Panel */}
      {showModelPanel && connectionStatus === "connected" && (
        <div style={{ marginBottom: 24 }}>
          <ModelSelector
            availableModels={info?.available_models || []}
            currentModelId={info?.model_id || null}
            modelLoaded={modelLoaded}
            isLoading={info?.loading || false}
            onModelChanged={handleModelChanged}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="tabs-container">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.emoji} {tab.label}
          </button>
        ))}
      </div>

      {/* Model mismatch warning */}
      {modelLoaded && !currentTabMatchesModel() && (
        <div className="status-bar info" style={{ marginBottom: 16 }}>
          ⚠️ 현재 로드된 모델({info?.model_id?.split("/").pop()})은 이 탭과 호환되지 않습니다.
          모델 패널에서 적절한 모델을 로드하세요.
        </div>
      )}

      {/* Tab Content */}
      {activeTab === "custom-voice" && (
        <CustomVoiceTab
          languages={languages}
          speakers={speakers}
          modelLoaded={modelLoaded && modelKind === "custom_voice"}
        />
      )}
      {activeTab === "voice-design" && (
        <VoiceDesignTab
          languages={languages}
          modelLoaded={modelLoaded && modelKind === "voice_design"}
        />
      )}
      {activeTab === "voice-clone" && (
        <VoiceCloneTab
          languages={languages}
          modelLoaded={modelLoaded && modelKind === "base"}
        />
      )}
      {activeTab === "novel-tts" && (
        <NovelTTSTab
          languages={languages}
          speakers={speakers}
          modelLoaded={modelLoaded && modelKind === "custom_voice"}
        />
      )}
    </div>
  );
}

export default App;
