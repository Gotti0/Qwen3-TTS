import React, { useRef, useState } from "react";
import { generateNovelTTSStream } from "../api";
import type { SSEProgressEvent } from "../api";
import AudioPlayer from "./AudioPlayer";
import LoadingWaves from "./LoadingWaves";

interface Props {
    languages: string[];
    speakers: string[];
    modelLoaded: boolean;
}

const DEFAULT_INSTRUCT = `Dark Xianxia / martial arts novel narration. Overall slow, lingering breath (0.9x pace), subtle reverb for atmospheric depth.

[Narrator] Medium-low pitch, calm and composed narration. Switch to whispery ASMR tone for sensual descriptions.
[Male character] Low pitch with vocal fry, wicked and arrogant tone. Drawl endings when taunting, rough breathing when excited.
[Female character] Clear high pitch with trembling, cold but gradually breaking down. Quiver at line endings when resisting, stammering with tearful tone when pleading.

Maximize emotional inflection for quoted dialogue. Fill ellipses (……) with trembling breath instead of silence. Apply dreamy reverb to inner monologue.`;

const NovelTTSTab: React.FC<Props> = ({ languages, speakers, modelLoaded }) => {
    const [text, setText] = useState("");
    const [language, setLanguage] = useState("Auto");
    const [speaker, setSpeaker] = useState(speakers[0] || "Vivian");
    const [instruct, setInstruct] = useState(DEFAULT_INSTRUCT);
    const [maxChars, setMaxChars] = useState(200);
    const [pauseMs, setPauseMs] = useState(500);
    const [scenePauseMs, setScenePauseMs] = useState(1500);
    const [useSemanticSplit, setUseSemanticSplit] = useState(true);
    const [loading, setLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Progress state
    const [progressCurrent, setProgressCurrent] = useState(0);
    const [progressTotal, setProgressTotal] = useState(0);
    const [progressText, setProgressText] = useState("");
    const [totalElapsed, setTotalElapsed] = useState(0);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const startTimeRef = useRef<number>(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const charCount = text.length;
    const estimatedChunks = maxChars > 0 ? Math.max(1, Math.ceil(charCount / maxChars)) : 0;

    const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const content = ev.target?.result;
            if (typeof content === "string") setText(content);
        };
        reader.readAsText(file, "UTF-8");
    };

    const handleGenerate = async () => {
        if (!text.trim()) {
            setError("소설 텍스트를 입력하거나 파일을 업로드해주세요.");
            return;
        }
        setError("");
        setLoading(true);
        setAudioUrl(null);
        setProgressCurrent(0);
        setProgressTotal(0);
        setProgressText("청킹 중...");
        setTotalElapsed(0);

        // 경과 시간 타이머
        startTimeRef.current = Date.now();
        timerRef.current = setInterval(() => {
            setTotalElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 500);

        try {
            const url = await generateNovelTTSStream(
                text, language, speaker, instruct,
                maxChars, pauseMs, scenePauseMs, useSemanticSplit,
                (event: SSEProgressEvent) => {
                    if (event.type === "progress") {
                        setProgressCurrent(event.current || 0);
                        setProgressTotal(event.total || 0);
                        setProgressText(event.chunk_text || "");
                    }
                },
            );
            setAudioUrl(url);
        } catch (e: any) {
            setError(e.message || "소설 TTS 생성에 실패했습니다.");
        } finally {
            setLoading(false);
            if (timerRef.current) clearInterval(timerRef.current);
        }
    };

    const progressPercent = progressTotal > 0 ? (progressCurrent / progressTotal) * 100 : 0;

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return m > 0 ? `${m}분 ${sec}초` : `${sec}초`;
    };

    return (
        <div className="card">
            <div className="card-title">
                <span className="icon">📖</span>
                Novel TTS — 소설 텍스트를 자연스러운 음성으로 변환
            </div>

            {/* Text Input */}
            <div className="form-group">
                <label className="form-label">
                    소설 텍스트
                    <span style={{ float: "right", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                        {charCount.toLocaleString()}자 · 예상 {estimatedChunks}청크
                    </span>
                </label>
                <textarea
                    className="form-textarea"
                    rows={10}
                    placeholder={"소설 텍스트를 입력하거나 .txt 파일을 업로드하세요.\n\n장면 전환은 *** 또는 --- 마커를 사용하거나,\n의미 기반 자동 분할을 활성화하면 마커 없이도 분할됩니다."}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    style={{ minHeight: 200, fontFamily: "'Inter', monospace", fontSize: "0.88rem", lineHeight: 1.8 }}
                />
            </div>

            {/* File Upload */}
            <div style={{ marginBottom: 18 }}>
                <div
                    className={`file-upload-area ${text ? "has-file" : ""}`}
                    onClick={() => fileInputRef.current?.click()}
                    style={{ padding: 16 }}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.md,.text"
                        onChange={handleFileLoad}
                    />
                    <span className="upload-text">
                        📄 .txt / .md 파일 클릭하여 업로드
                    </span>
                </div>
            </div>

            {/* Language & Speaker */}
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
                        {speakers.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Instruct */}
            <div className="form-group">
                <label className="form-label">지시문 (감정/톤 프리셋)</label>
                <textarea
                    className="form-textarea"
                    rows={4}
                    placeholder="TTS 감정/톤 지시 XML 블록"
                    value={instruct}
                    onChange={(e) => setInstruct(e.target.value)}
                    style={{ fontSize: "0.8rem", fontFamily: "monospace", lineHeight: 1.5 }}
                />
            </div>

            {/* Advanced Settings Toggle */}
            <div style={{ marginBottom: 18 }}>
                <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    style={{
                        background: "transparent",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-secondary)",
                        padding: "8px 16px",
                        fontSize: "0.82rem",
                        fontFamily: "inherit",
                        cursor: "pointer",
                        transition: "var(--transition)",
                        width: "100%",
                        textAlign: "left",
                    }}
                >
                    ⚙️ 고급 설정 {showAdvanced ? "▲" : "▼"}
                </button>

                {showAdvanced && (
                    <div style={{
                        marginTop: 12,
                        padding: 20,
                        background: "var(--bg-input)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-md)",
                    }}>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">청크 최대 글자 수</label>
                                <input
                                    className="form-input"
                                    type="number"
                                    min={50}
                                    max={500}
                                    value={maxChars}
                                    onChange={(e) => setMaxChars(Number(e.target.value))}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">청크 간 무음 (ms)</label>
                                <input
                                    className="form-input"
                                    type="number"
                                    min={0}
                                    max={3000}
                                    step={100}
                                    value={pauseMs}
                                    onChange={(e) => setPauseMs(Number(e.target.value))}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">장면 전환 무음 (ms)</label>
                                <input
                                    className="form-input"
                                    type="number"
                                    min={0}
                                    max={5000}
                                    step={100}
                                    value={scenePauseMs}
                                    onChange={(e) => setScenePauseMs(Number(e.target.value))}
                                />
                            </div>
                            <div className="form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
                                <div className="form-checkbox-group">
                                    <input
                                        type="checkbox"
                                        id="semantic-split"
                                        checked={useSemanticSplit}
                                        onChange={(e) => setUseSemanticSplit(e.target.checked)}
                                    />
                                    <label htmlFor="semantic-split">
                                        의미 기반 장면 분할 (Voyage API)
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Progress Bar */}
            {loading && (
                <div className="progress-container">
                    <div className="progress-header">
                        <span className="progress-label">
                            🔊 {progressCurrent}/{progressTotal || "?"} 청크 생성 중
                        </span>
                        <span className="progress-time">{formatTime(totalElapsed)}</span>
                    </div>
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                    {progressText && (
                        <div className="progress-text">"{progressText}..."</div>
                    )}
                </div>
            )}

            {/* Generate Button */}
            <button
                className={`btn-generate ${loading ? "loading" : ""}`}
                onClick={handleGenerate}
                disabled={loading || !modelLoaded}
            >
                {loading
                    ? <><LoadingWaves /> <span style={{ marginLeft: 8 }}>생성 중...</span></>
                    : !modelLoaded
                        ? "⚠ 모델 미연결"
                        : `📖 소설 음성 생성 (${estimatedChunks}청크)`
                }
            </button>

            {error && <div className="status-bar error">{error}</div>}
            <AudioPlayer audioUrl={audioUrl} />
        </div>
    );
};

export default NovelTTSTab;
