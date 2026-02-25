import React, { useRef, useState, useEffect } from "react";
import { generateNovelTTSStream } from "../api";
import type { SSEProgressEvent } from "../api";
import AudioPlayer from "./AudioPlayer";
import LoadingWaves from "./LoadingWaves";

interface Props {
    languages: string[];
    speakers: string[];
    modelLoaded: boolean;
}

const DEFAULT_INSTRUCT = `Dark Xianxia and martial arts novel narration with dynamic, tense pacing at standard 1.0x to 1.05x speed, using crisp articulation and subtle reverb for atmospheric depth without dragging the tempo.

[Narrator] Medium-low pitch, rhythmically engaging and composed narration, switching to an intense, close-mic whisper with rapid delivery for sensual descriptions to maintain momentum.
[Male character] Low pitch with subtle vocal fry, wicked and arrogant tone, using a snappy, biting delivery instead of drawling when taunting, and heavy, rapid breathing when excited.
[Female character] Clear high pitch with urgent trembling, cold but breaking down with fast, breathless pacing, quivering sharply at line endings when resisting, and stammering with desperate, quickened tearful urgency when pleading.

Maximize emotional inflection for quoted dialogue with rapid back-and-forths, filling ellipses (……) with short, sharp inhales to build tension rather than long pauses, and apply dreamy reverb to inner monologue while keeping the internal tempo brisk and fluid.`;

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
    const abortControllerRef = useRef<AbortController | null>(null);

    const charCount = text.length;
    const estimatedChunks = maxChars > 0 ? Math.max(1, Math.ceil(charCount / maxChars)) : 0;

    // 브라우저 새로고침/이탈 방지 (로딩 중일 때만)
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (loading) {
                e.preventDefault();
                e.returnValue = ""; // Chrome 등에서 경고창을 띄우기 위한 표준 권장사항
            }
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [loading]);

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

        // 기존에 진행 중인 요청이 있다면 취소(방어)
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

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
                abortControllerRef.current.signal
            );
            setAudioUrl(url);
        } catch (e: any) {
            if (e.name === "AbortError" || e.message?.includes("aborted")) {
                setError("생성이 취소되었습니다.");
            } else {
                setError(e.message || "소설 TTS 생성에 실패했습니다.");
            }
        } finally {
            setLoading(false);
            if (timerRef.current) clearInterval(timerRef.current);
            abortControllerRef.current = null;
        }
    };

    const handleCancel = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
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

            <div style={{ display: "flex", gap: "10px" }}>
                <button
                    className={`btn-generate ${loading ? "loading" : ""}`}
                    onClick={handleGenerate}
                    disabled={loading || !modelLoaded}
                    style={{ flex: 1 }}
                >
                    {loading
                        ? <><LoadingWaves /> <span style={{ marginLeft: 8 }}>생성 중...</span></>
                        : !modelLoaded
                            ? "⚠ 모델 미연결"
                            : `📖 소설 음성 생성 (${estimatedChunks}청크)`
                    }
                </button>

                {loading && (
                    <button
                        className="btn-default"
                        onClick={handleCancel}
                        style={{
                            backgroundColor: "var(--bg-input)",
                            color: "var(--error-color)",
                            border: "1px solid var(--error-color)",
                            padding: "0 20px",
                            fontWeight: 600,
                            borderRadius: "var(--radius-md)",
                        }}
                    >
                        취소
                    </button>
                )}
            </div>

            {error && <div className="status-bar error">{error}</div>}
            <AudioPlayer audioUrl={audioUrl} />
        </div>
    );
};

export default NovelTTSTab;
