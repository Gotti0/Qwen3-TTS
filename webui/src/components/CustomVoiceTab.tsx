import React, { useState } from "react";
import { generateCustomVoice } from "../api";
import AudioPlayer from "./AudioPlayer";
import LoadingWaves from "./LoadingWaves";

interface Props {
    languages: string[];
    speakers: string[];
    modelLoaded: boolean;
}

const SPEAKER_INFO: Record<string, { desc: string; lang: string }> = {
    Vivian: { desc: "밝고 날카로운 젊은 여성", lang: "Chinese" },
    Serena: { desc: "따뜻하고 부드러운 여성", lang: "Chinese" },
    Uncle_Fu: { desc: "낮고 깊은 중년 남성", lang: "Chinese" },
    Dylan: { desc: "베이징 남성, 맑고 자연스러운 음색", lang: "Chinese" },
    Eric: { desc: "쓰촨 남성, 활기찬 목소리", lang: "Chinese" },
    Ryan: { desc: "역동적인 남성, 강한 리듬감", lang: "English" },
    Aiden: { desc: "밝은 미국식 남성", lang: "English" },
    Ono_Anna: { desc: "발랄한 일본 여성", lang: "Japanese" },
    Sohee: { desc: "따뜻하고 감성적인 한국 여성", lang: "Korean" },
};

const CustomVoiceTab: React.FC<Props> = ({ languages, speakers, modelLoaded }) => {
    const [text, setText] = useState("");
    const [language, setLanguage] = useState("Auto");
    const [speaker, setSpeaker] = useState(speakers[0] || "Vivian");
    const [instruct, setInstruct] = useState("");
    const [loading, setLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [error, setError] = useState("");

    const handleGenerate = async () => {
        if (!text.trim()) {
            setError("텍스트를 입력해주세요.");
            return;
        }
        setError("");
        setLoading(true);
        setAudioUrl(null);
        try {
            const blob = await generateCustomVoice(text, language, speaker, instruct);
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
                <span className="icon">🎙️</span>
                Custom Voice — 내장 음성으로 TTS 생성
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

            <div className="form-row">
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
                    <label className="form-label">스피커</label>
                    <select
                        className="form-select"
                        value={speaker}
                        onChange={(e) => setSpeaker(e.target.value)}
                    >
                        {(speakers.length > 0 ? speakers : Object.keys(SPEAKER_INFO)).map((s) => (
                            <option key={s} value={s}>
                                {s} — {SPEAKER_INFO[s]?.desc || ""}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="form-group">
                <label className="form-label">지시문 (선택)</label>
                <input
                    className="form-input"
                    placeholder="예: 따뜻하고 친근한 어조로, 빠르게 말해줘"
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

export default CustomVoiceTab;
