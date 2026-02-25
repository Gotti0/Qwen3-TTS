import React, { useRef, useState } from "react";
import { generateVoiceClone } from "../api";
import AudioPlayer from "./AudioPlayer";
import LoadingWaves from "./LoadingWaves";

interface Props {
    languages: string[];
    modelLoaded: boolean;
}

const VoiceCloneTab: React.FC<Props> = ({ languages, modelLoaded }) => {
    const [text, setText] = useState("");
    const [language, setLanguage] = useState("Auto");
    const [refText, setRefText] = useState("");
    const [xVectorOnly, setXVectorOnly] = useState(false);
    const [refFile, setRefFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [error, setError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleGenerate = async () => {
        if (!text.trim()) {
            setError("합성할 텍스트를 입력해주세요.");
            return;
        }
        if (!refFile) {
            setError("레퍼런스 오디오 파일을 업로드해주세요.");
            return;
        }
        if (!xVectorOnly && !refText.trim()) {
            setError("레퍼런스 오디오의 전사 텍스트를 입력하거나, 'x-vector only' 모드를 활성화하세요.");
            return;
        }
        setError("");
        setLoading(true);
        setAudioUrl(null);
        try {
            const blob = await generateVoiceClone(text, language, refFile, refText, xVectorOnly);
            setAudioUrl(URL.createObjectURL(blob));
        } catch (e: any) {
            setError(e.message || "생성에 실패했습니다.");
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setRefFile(e.target.files[0]);
        }
    };

    return (
        <div className="card">
            <div className="card-title">
                <span className="icon">🎤</span>
                Voice Clone — 음성 복제
            </div>

            {/* Reference Audio Upload */}
            <div className="form-group">
                <label className="form-label">레퍼런스 오디오</label>
                <div
                    className={`file-upload-area ${refFile ? "has-file" : ""}`}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*"
                        onChange={handleFileChange}
                    />
                    {refFile ? (
                        <>
                            <div className="upload-icon">🎵</div>
                            <div className="file-name">{refFile.name}</div>
                            <div className="upload-text" style={{ marginTop: 4 }}>
                                클릭하여 변경
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="upload-icon">📁</div>
                            <div className="upload-text">
                                클릭하여 레퍼런스 오디오 업로드 (.wav, .mp3 등)
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="form-group">
                <label className="form-label">레퍼런스 오디오 전사 텍스트</label>
                <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="레퍼런스 오디오에서 말한 내용을 입력하세요..."
                    value={refText}
                    onChange={(e) => setRefText(e.target.value)}
                    disabled={xVectorOnly}
                />
            </div>

            <div className="form-checkbox-group">
                <input
                    type="checkbox"
                    id="xvec-only"
                    checked={xVectorOnly}
                    onChange={(e) => setXVectorOnly(e.target.checked)}
                />
                <label htmlFor="xvec-only">
                    x-vector only 모드 (전사 텍스트 없이 음성 복제, 품질 저하 가능)
                </label>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "18px 0" }} />

            <div className="form-group">
                <label className="form-label">합성할 텍스트</label>
                <textarea
                    className="form-textarea"
                    rows={4}
                    placeholder="복제된 목소리로 말할 문장을 입력하세요..."
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

export default VoiceCloneTab;
