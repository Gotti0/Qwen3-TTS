import React, { useState } from "react";
import { generateVoiceDesign } from "../api";
import AudioPlayer from "./AudioPlayer";
import LoadingWaves from "./LoadingWaves";

interface Props {
    languages: string[];
    modelLoaded: boolean;
}

const VoiceDesignTab: React.FC<Props> = ({ languages, modelLoaded }) => {
    const [text, setText] = useState("");
    const [language, setLanguage] = useState("Auto");
    const [instruct, setInstruct] = useState("");
    const [loading, setLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [error, setError] = useState("");

    const handleGenerate = async () => {
        if (!text.trim()) {
            setError("텍스트를 입력해주세요.");
            return;
        }
        if (!instruct.trim()) {
            setError("음성 디자인 설명을 입력해주세요.");
            return;
        }
        setError("");
        setLoading(true);
        setAudioUrl(null);
        try {
            const blob = await generateVoiceDesign(text, language, instruct);
            setAudioUrl(URL.createObjectURL(blob));
        } catch (e: any) {
            setError(e.message || "생성에 실패했습니다.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="card">
            <div className="card-title">
                <span className="icon">🎨</span>
                Voice Design — 자연어로 음성 디자인
            </div>

            <div className="form-group">
                <label className="form-label">합성할 텍스트</label>
                <textarea
                    className="form-textarea"
                    rows={4}
                    placeholder="합성할 문장을 입력하세요..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                />
            </div>

            <div className="form-group">
                <label className="form-label">언어</label>
                <select
                    className="form-select"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                >
                    <option value="Auto">Auto (자동 감지)</option>
                    {languages.map((l) => (
                        <option key={l} value={l}>{l}</option>
                    ))}
                </select>
            </div>

            <div className="form-group">
                <label className="form-label">음성 디자인 설명</label>
                <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="예: 20대 남성, 밝고 에너지 넘치는 목소리, 약간 빠른 템포"
                    value={instruct}
                    onChange={(e) => setInstruct(e.target.value)}
                />
            </div>

            <button
                className={`btn-generate ${loading ? "loading" : ""}`}
                onClick={handleGenerate}
                disabled={loading || !modelLoaded}
            >
                {loading ? <LoadingWaves /> : !modelLoaded ? "⚠ 모델 미연결" : "🎵 음성 생성"}
            </button>

            {error && <div className="status-bar error">{error}</div>}
            <AudioPlayer audioUrl={audioUrl} />
        </div>
    );
};

export default VoiceDesignTab;
