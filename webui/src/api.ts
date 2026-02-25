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
