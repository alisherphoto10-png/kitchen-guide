import sys, json, subprocess, numpy as np
def load(f):
    raw = subprocess.check_output(['ffmpeg','-v','error','-i',f,'-f','f32le','-ac','1','-ar','16000','-'])
    return np.frombuffer(raw, np.float32)
from faster_whisper import WhisperModel
m = WhisperModel('small', device='cpu', compute_type='int8')
lines = dict(json.load(open(sys.argv[1] + '/lines.json')))
for voice in ['irina', 'dmitri', 'ruslan']:
    for k in ['p1_weights', 'p2_card', 'p2_export']:
        segs, _ = m.transcribe(load(f'{sys.argv[1]}/{voice}_{k}.wav'), language='ru', beam_size=5)
        print(voice, k, '→', ''.join(s.text for s in segs).strip())
