const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8100";

export interface AvailableModel {
    id: string;
    name: string;
    kind: string;
    size: string;
    description: string;
}

export interface ModelInfo {
    model_loaded: boolean;
    model_kind: string | null;
    model_id: string | null;
    supported_languages: string[];
    supported_speakers: string[];
    available_models: AvailableModel[];
    loading: boolean;
}

export async function fetchModelInfo(): Promise<ModelInfo> {
    const res = await fetch(`${API_BASE}/api/info`);
    if (!res.ok) throw new Error(`Failed to fetch model info: ${res.status}`);
    return res.json();
}

export async function loadModel(modelId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/api/model/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Model loading failed");
    }
    return res.json();
}

export async function unloadModel(): Promise<any> {
    const res = await fetch(`${API_BASE}/api/model/unload`, {
        method: "POST",
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Model unloading failed");
    }
    return res.json();
}

export async function generateCustomVoice(
    text: string,
    language: string,
    speaker: string,
    instruct: string
): Promise<Blob> {
    const form = new FormData();
    form.append("text", text);
    form.append("language", language);
    form.append("speaker", speaker);
    form.append("instruct", instruct);

    const res = await fetch(`${API_BASE}/api/generate/custom-voice`, {
        method: "POST",
        body: form,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Generation failed");
    }
    return res.blob();
}

export async function generateVoiceDesign(
    text: string,
    language: string,
    instruct: string
): Promise<Blob> {
    const form = new FormData();
    form.append("text", text);
    form.append("language", language);
    form.append("instruct", instruct);

    const res = await fetch(`${API_BASE}/api/generate/voice-design`, {
        method: "POST",
        body: form,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Generation failed");
    }
    return res.blob();
}

export async function generateVoiceClone(
    text: string,
    language: string,
    refAudio: File,
    refText: string,
    xVectorOnly: boolean
): Promise<Blob> {
    const form = new FormData();
    form.append("text", text);
    form.append("language", language);
    form.append("ref_audio", refAudio);
    form.append("ref_text", refText);
    form.append("x_vector_only", String(xVectorOnly));

    const res = await fetch(`${API_BASE}/api/generate/voice-clone`, {
        method: "POST",
        body: form,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Generation failed");
    }
    return res.blob();
}

export async function generateNovelTTS(
    text: string,
    language: string,
    speaker: string,
    instruct: string,
    maxChars: number = 200,
    pauseMs: number = 500,
    scenePauseMs: number = 1500,
    useSemanticSplit: boolean = true,
): Promise<Blob> {
    const form = new FormData();
    form.append("text", text);
    form.append("language", language);
    form.append("speaker", speaker);
    form.append("instruct", instruct);
    form.append("max_chars", String(maxChars));
    form.append("pause_ms", String(pauseMs));
    form.append("scene_pause_ms", String(scenePauseMs));
    form.append("use_semantic_split", String(useSemanticSplit));

    const res = await fetch(`${API_BASE}/api/generate/novel`, {
        method: "POST",
        body: form,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Novel TTS generation failed");
    }
    return res.blob();
}

export interface SSEProgressEvent {
    type: "progress" | "complete" | "error";
    current?: number;
    total?: number;
    chunk_text?: string;
    elapsed_s?: number;
    audio_duration_s?: number;
    audio_url?: string;
    duration_s?: number;
    message?: string;
}

export async function generateNovelTTSStream(
    text: string,
    language: string,
    speaker: string,
    instruct: string,
    maxChars: number,
    pauseMs: number,
    scenePauseMs: number,
    useSemanticSplit: boolean,
    onEvent: (event: SSEProgressEvent) => void,
    abortSignal?: AbortSignal,
): Promise<string> {
    const form = new FormData();
    form.append("text", text);
    form.append("language", language);
    form.append("speaker", speaker);
    form.append("instruct", instruct);
    form.append("max_chars", String(maxChars));
    form.append("pause_ms", String(pauseMs));
    form.append("scene_pause_ms", String(scenePauseMs));
    form.append("use_semantic_split", String(useSemanticSplit));

    const res = await fetch(`${API_BASE}/api/generate/novel/stream`, {
        method: "POST",
        body: form,
        signal: abortSignal,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "SSE stream failed");
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let audioUrl = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 파싱: "data: {...}\n\n"
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";  // 마지막 불완전 청크 보존

        for (const block of lines) {
            const dataLine = block.trim();
            if (!dataLine.startsWith("data: ")) continue;
            try {
                const event: SSEProgressEvent = JSON.parse(dataLine.slice(6));
                onEvent(event);
                if (event.type === "complete" && event.audio_url) {
                    audioUrl = `${API_BASE}${event.audio_url}`;
                }
                if (event.type === "error") {
                    throw new Error(event.message || "Generation failed");
                }
            } catch (e) {
                if (e instanceof SyntaxError) continue;
                throw e;
            }
        }
    }

    return audioUrl;
}

