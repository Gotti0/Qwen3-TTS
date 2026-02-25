import React, { useState } from "react";
import { loadModel, unloadModel } from "../api";
import type { AvailableModel } from "../api";

interface Props {
    availableModels: AvailableModel[];
    currentModelId: string | null;
    modelLoaded: boolean;
    isLoading: boolean;
    onModelChanged: () => void;
}

const KIND_EMOJI: Record<string, string> = {
    custom_voice: "🎙️",
    voice_design: "🎨",
    base: "🎤",
};

const ModelSelector: React.FC<Props> = ({
    availableModels,
    currentModelId,
    modelLoaded,
    isLoading,
    onModelChanged,
}) => {
    const [selectedId, setSelectedId] = useState(currentModelId || "");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleLoad = async () => {
        if (!selectedId) return;
        setError("");
        setLoading(true);
        try {
            await loadModel(selectedId);
            onModelChanged();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUnload = async () => {
        setError("");
        setLoading(true);
        try {
            await unloadModel();
            onModelChanged();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const isWorking = loading || isLoading;

    return (
        <div className="model-selector">
            <div className="model-selector-header">
                <span className="model-selector-icon">⚡</span>
                <span>모델 관리</span>
            </div>

            <div className="model-cards">
                {availableModels.map((m) => (
                    <label
                        key={m.id}
                        className={`model-card ${selectedId === m.id ? "selected" : ""} ${currentModelId === m.id && modelLoaded ? "active" : ""
                            }`}
                    >
                        <input
                            type="radio"
                            name="model"
                            value={m.id}
                            checked={selectedId === m.id}
                            onChange={() => setSelectedId(m.id)}
                            disabled={isWorking}
                        />
                        <div className="model-card-content">
                            <div className="model-card-top">
                                <span className="model-card-emoji">{KIND_EMOJI[m.kind] || "📦"}</span>
                                <span className="model-card-name">{m.name}</span>
                                <span className="model-card-size">{m.size}</span>
                                {currentModelId === m.id && modelLoaded && (
                                    <span className="model-card-active-badge">활성</span>
                                )}
                            </div>
                            <div className="model-card-desc">{m.description}</div>
                        </div>
                    </label>
                ))}
            </div>

            <div className="model-actions">
                <button
                    className="btn-model-load"
                    onClick={handleLoad}
                    disabled={isWorking || !selectedId || (selectedId === currentModelId && modelLoaded)}
                >
                    {isWorking ? "⏳ 로딩 중..." : "🚀 모델 로드"}
                </button>
                <button
                    className="btn-model-unload"
                    onClick={handleUnload}
                    disabled={isWorking || !modelLoaded}
                >
                    ⏏ 언로드
                </button>
            </div>

            {error && <div className="status-bar error">{error}</div>}
        </div>
    );
};

export default ModelSelector;
