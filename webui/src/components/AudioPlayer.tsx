import React, { useRef } from "react";

interface AudioPlayerProps {
    audioUrl: string | null;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioUrl }) => {
    const audioRef = useRef<HTMLAudioElement>(null);

    if (!audioUrl) return null;

    const handleDownload = () => {
        const a = document.createElement("a");
        a.href = audioUrl;
        a.download = `qwen3_tts_output_${Date.now()}.wav`;
        a.click();
    };

    return (
        <div className="audio-player-section">
            <div className="audio-player-card">
                <h3>
                    <span>🔊</span> 생성된 오디오
                </h3>
                <audio ref={audioRef} controls src={audioUrl} />
                <div className="audio-actions">
                    <button className="btn-download" onClick={handleDownload}>
                        ⬇ 다운로드
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AudioPlayer;
