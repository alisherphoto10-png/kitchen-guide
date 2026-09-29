# Озвучка видео-инструкции: режем клипы по сценам, в начало сцены — реплика,
# если реплика длиннее сцены — «замораживаем» последний кадр сцены.
import json, subprocess, os
VO = os.path.join(os.path.dirname(__file__), '..', 'vo'); VOICE = 'irina'
LEAD, TAIL = 0.35, 0.6          # пауза до реплики и после неё
def dur(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
def run(c): subprocess.run(c, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def seg(src, a, b, voice, out):
    """кусок [a,b) клипа src (b=None — до конца) + реплика voice (или тишина)"""
    length = (b if b is not None else dur(src)) - a
    need = (dur(voice) + LEAD + TAIL) if voice else 0
    pad = max(0, need - length)
    total = length + pad
    cmd = ['ffmpeg','-y','-ss',f'{a:.3f}','-t',f'{length:.3f}','-i',src]
    if voice:
        cmd += ['-i', voice, '-filter_complex',
                f"[0:v]fps=30,tpad=stop_mode=clone:stop_duration={pad:.3f}[v];[1:a]aresample=48000,adelay={int(LEAD*1000)}:all=1,apad,atrim=0:{total:.3f}[a]",
                '-map','[v]','-map','[a]']
    else:
        cmd += ['-f','lavfi','-t',f'{total:.3f}','-i','anullsrc=r=48000:cl=mono','-filter_complex','[0:v]fps=30[v]','-map','[v]','-map','1:a']
    cmd += ['-c:v','libx264','-pix_fmt','yuv420p','-crf','23','-preset','medium','-c:a','aac','-b:a','128k','-ac','1','-ar','48000','-t',f'{total:.3f}',out]
    run(cmd); return total

def part(name, groups):
    caps = json.load(open(name + '.json')); off = caps[0]['start'] - 0.4
    starts = {c['title']: c['start'] - off for c in caps}
    cuts = [0.0] + [starts[t] for t, _ in groups]
    keys = [None] + [k for _, k in groups]
    outs = []
    for i, (a, k) in enumerate(zip(cuts, keys)):
        b = cuts[i + 1] if i + 1 < len(cuts) else None
        if b is not None and b - a < 0.05: continue
        o = f'{name}_s{i}.mp4'
        seg(name + '_c.mp4', a, b, f'{VO}/{VOICE}_{k}.wav' if k else None, o); outs.append(o)
    return outs

files = []
files.append('intro_v.mp4'); seg('intro.mp4', 0, None, f'{VO}/{VOICE}_intro.wav', 'intro_v.mp4')
files += part('part1', [('Новый акт', 'p1_select'), ('Шаг 2. Веса', 'p1_weights'), ('Шаг 3. Фото', 'p1_photo'),
                        ('Шаг 4. Проверка', 'p1_review'), ('Шаг 5. Отправлено', 'p1_sent')])
seg('mid.mp4', 0, None, None, 'mid_v.mp4'); files.append('mid_v.mp4')
files += part('part2', [('Поиск и фильтры', 'p2_filters'), ('Карточка акта', 'p2_card'),
                        ('Дополнительная информация', 'p2_extra'), ('Экспорт', 'p2_export')])
seg('outro.mp4', 0, None, f'{VO}/{VOICE}_outro.wav', 'outro_v.mp4'); files.append('outro_v.mp4')
open('list_v.txt', 'w').write(''.join(f"file '{f}'\n" for f in files))
run(['ffmpeg','-y','-f','concat','-safe','0','-i','list_v.txt','-c','copy','-movflags','+faststart','akty-razdelki-video-ozvuchka.mp4'])
print('done', round(dur('akty-razdelki-video-ozvuchka.mp4'), 1))
