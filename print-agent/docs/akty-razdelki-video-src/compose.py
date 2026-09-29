import json, subprocess
FONT='DejaVu Sans'
def ts(t):
    t=max(0,t); h=int(t//3600); m=int(t%3600//60); s=t%60
    return f"{h}:{m:02d}:{s:05.2f}"
HEAD="""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: T,{f},58,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,60,60,70,1
Style: D,{f},38,&H00D2BDA6,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,60,60,160,1
Style: S,{f},30,&H00FF8A3D,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,60,60,24,1
Style: C,{f},64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,80,80,0,1
Style: B,{f},42,&H00D2BDA6,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,150,80,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""".replace('{f}',FONT)
def ev(st,a,b,text): return f"Dialogue: 0,{ts(a)},{ts(b)},{st},,0,0,0,,{text}\n"
def run(cmd): print(' '.join(cmd[:3]),'...'); subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

def part(name, label):
    caps=json.load(open(name+'.json')); start=caps[0]['start']-0.4; end=caps[-1]['end']+0.3
    ass=HEAD+ev('S',0,end-start,label)
    for c in caps:
        ass+=ev('T',c['start']-start,c['end']-start,c['title'])+ev('D',c['start']-start,c['end']-start,c['text'].replace('\n','\\N'))
    open(name+'.ass','w').write(ass)
    # телефон 780x1688 → высота 1560, по центру снизу; фон — цвет страницы
    run(['ffmpeg','-y','-ss',str(start),'-to',str(end),'-i',name+'.webm','-filter_complex',
      "color=c=0x050C16:s=1080x1920:r=30[bg];[0:v]fps=30,crop=390:844:0:0,scale=-2:1560:flags=lanczos,pad=iw+4:ih+4:2:2:color=0x2A3A52[ph];[bg][ph]overlay=(W-w)/2:330:shortest=1,ass="+name+".ass[v]",
      '-map','[v]','-c:v','libx264','-pix_fmt','yuv420p','-crf','23','-preset','medium',name+'_c.mp4'])

def card(name, dur, title, lines):
    ass=HEAD+ev('C',0,dur,title)
    if lines:
        ass=HEAD+"Dialogue: 0,0:00:00.00,%s,C,,0,0,0,,{\\pos(540,620)}%s\n"%(ts(dur),title)
        y=820
        for l in lines:
            ass+="Dialogue: 0,0:00:00.00,%s,B,,0,0,0,,{\\pos(150,%d)}%s\n"%(ts(dur),y,l); y+=90
    open(name+'.ass','w').write(ass)
    run(['ffmpeg','-y','-f','lavfi','-i',f'color=c=0x050C16:s=1080x1920:r=30:d={dur}','-vf','ass='+name+'.ass','-c:v','libx264','-pix_fmt','yuv420p','-crf','23',name+'.mp4'])

card('intro',6,'Акты разделки —\\Nновый интерфейс',['• список: поиск и фильтры','• новый акт — 5 простых шагов','• фото и комментарии к акту','• история изменений','• экспорт PDF / Excel / PNG'])
part('part1','ДЛЯ ПОВАРА · создание акта')
card('mid',3,'Для руководителя',[])
part('part2','ДЛЯ РУКОВОДИТЕЛЯ · проверка и экспорт')
card('outro',4,'KitchenDesk\\N{\\fs40\\c&HD2BDA6&}Вопросы — в «Профиль → Поддержка»',[])
open('list.txt','w').write(''.join(f"file '{n}'\n" for n in ['intro.mp4','part1_c.mp4','mid.mp4','part2_c.mp4','outro.mp4']))
run(['ffmpeg','-y','-f','concat','-safe','0','-i','list.txt','-c','copy','akty-razdelki-video.mp4'])
