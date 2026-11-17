import csv, collections, sys
sys.path.insert(0,'.')
from ref_matcher import load, classify
settings, tags = load('tags.starter.toml')

# hand-written edge cases: (input, expected_dest, expected_rule, why)
EDGE = [
 ("Chisa.png","Wuthering-Waves/Chisa","One folder","plain single tag"),
 ("CHISA.PNG","Wuthering-Waves/Chisa","One folder","case-insensitive name and extension"),
 ("chisa.jpeg","Wuthering-Waves/Chisa","One folder","jpeg extension accepted"),
 ("Chisa waterfall.png","Wuthering-Waves/Chisa","Specific beats generic","a generic tag never beats a specific one"),
 ("Chisa Aemeath.png","Wuthering-Waves","Shared parent","two characters of one game go to the game folder"),
 ("Chisa Skadi.png","INBOX","Conflict","characters from different games"),
 ("Chisa Wuthering Waves.png","Wuthering-Waves/Chisa","Deepest folder wins","game tag is an ancestor of the character"),
 ("Wuthering.Waves.full.4690373.png","Wuthering-Waves","One folder","game-level tag, Zerochan style"),
 ("wuwa wallpaper.jpg","Wuthering-Waves","One folder","game alias"),
 ("Chisa1.png","Wuthering-Waves/Chisa","One folder","digit boundary splits the word"),
 ("ChisaWallpaper.png","Wuthering-Waves/Chisa","One folder","camelCase boundary splits the word"),
 ("chisawallpaper.png","INBOX","No match","glued words do not match in whole-word mode"),
 ("workspace.png","INBOX","No match","'space' must not match inside 'workspace'"),
 ("my space wallpaper.png","Space","One folder","whole word 'space'"),
 ("Robin.full.4129629.jpg","INBOX","No match","strict tag: needs 'honkai' in the name"),
 ("robin honkai.png","Honkai-Star-Rail/Robin","One folder","strict tag satisfied"),
 ("__robin_honkai_and_1_more_drawn_by_chisa__66b60ada665db2ba13e3aec46e6b756a.png","Honkai-Star-Rail/Robin","One folder","artist name after drawn_by is ignored"),
 ("__original_drawn_by_chisa__66b60ada665db2ba13e3aec46e6b756a.jpg","INBOX","No match","only the artist is 'chisa'"),
 ("__sparkle_and_sparxie_honkai_and_1_more_drawn_by_x__1223c6db9e3741acb14354649f7bf88b.jpg","Honkai-Star-Rail","Shared parent","two Honkai Star Rail characters"),
 ("Konachan.com - 999999 arknights gladiia_(arknights) skadi_(arknights) specter_(arknights) water.jpg","Arknights","Shared parent","three Arknights characters"),
 ("Konachan.com - 999998 skadi_(arknights) water waterfall.jpg","Arknights/Skadi","Deepest folder wins","game + character both match; the waterfall is ignored"),
 ("skadi waterfall.png","Arknights/Skadi","Specific beats generic","character beats waterfall background"),
 ("Konachan.com - 999997 waterfall forest.jpg","Nature","One folder","short name, two generic keywords, same folder"),
 ("Konachan.com - 999996 solo long_hair dress sky clouds waterfall.jpg","INBOX","No match","generic tag ignored: name has too many words"),
 ("Konachan.com - 999995 wuthering_waves forest.jpg","Wuthering-Waves","Specific beats generic","game tag beats a generic tag at the same depth"),
 ("waterfall space.png","INBOX","Conflict","two generic folders, no shared parent"),
 ("naive-cloudy-landscape.jpg","Nature","One folder","plain scenery name"),
 ("wallhaven-1q2le9.jpg","INBOX","No match","opaque Wallhaven id"),
 ("wallhaven-ex.png","INBOX","No match","short Wallhaven id"),
 ("138032536_p0.jpg","INBOX","No match","Pixiv id only"),
 ("151861634_p0--.png","INBOX","No match","Pixiv extension style, no words"),
 ("1b3006020fef5585363280d7d5722beecb199e58.png","INBOX","No match","hex hash name"),
 ("naive-chisa-wuthering-waves-wuwa-art-4k-wallpaper-uhdpaper.com-19@3@d.jpg","Wuthering-Waves/Chisa","Deepest folder wins","character + game words"),
 ("Hiyuki.(Wuthering.Waves).full.4698402.jpg","Wuthering-Waves/Hiyuki","Deepest folder wins","character + game in brackets"),
 ("__cecilia_immergreen_and_malfoid_hololive_and_3_more_drawn_by_ducveagle__290b0866c6b46fe1c6a59d833ed0d8b1.jpg","INBOX","No match","Danbooru hid the series behind 'and_3_more'"),
 ("honkai_(series) tattoo.png","INBOX","No match","'honkai' alone is not a game"),
 ("Chisa 12.png","Wuthering-Waves/Chisa","One folder","an already numbered name still matches"),
 ("chisa.crdownload","IGNORE","Not an image","partial download"),
 ("chisa.png.part","IGNORE","Not an image","partial download (Firefox)"),
 ("Chisa.mp4","IGNORE","Not an image","videos come later"),
]
bad=0
rows=[]
for fn,exp,rule,why in EDGE:
    r=classify(fn,tags,settings)
    if r['dest']!=exp or r['rule']!=rule:
        bad+=1; print('EDGE MISMATCH',fn,'| expected',exp,rule,'| got',r['dest'],r['rule'])
    rows.append(['edge',fn,'',exp,rule,'edge',';'.join(r['tags']),why])
print('edge cases:',len(EDGE),'mismatches:',bad)

real=[]
cur=None
for l in open('tree_images.txt',encoding='utf8').read().split('\n'):
    if l.startswith('## '): cur=l[3:]
    elif l: real.append((cur,l))
stat=collections.Counter(); review=[]
for folder,fn in real:
    r=classify(fn,tags,settings); d=r['dest']; note=r.get('ignored','')
    if folder=='(root)':
        status='would-sort' if d!='INBOX' else 'inbox'
        if r['rule']=='Conflict': note='conflict stays in the Inbox'
    else:
        if d==folder or d.startswith(folder+'/'): status='agrees'
        elif d=='INBOX' and r['rule']=='No match': status='stays'; note=('no tag matches; re-sort leaves it in '+folder+(' ('+note+')' if note else ''))
        elif d=='INBOX': status='REVIEW'; note='tags clash ('+';'.join(r['tags'])+'); re-sort would leave it in '+folder
        else: status='REVIEW'; note='would move out of '+folder+' (matched: '+';'.join(r['tags'])+')'
    stat[(folder if folder=='(root)' else 'in folder',status)]+=1
    if status=='REVIEW': review.append((folder,fn,d,r['rule']))
    rows.append(['real',fn,folder,d,r['rule'],status,';'.join(r['tags']),note])
with open('cases.csv','w',newline='',encoding='utf8') as f:
    w=csv.writer(f); w.writerow(['section','input','current_folder','expected_dest','rule','status','matched','note']); w.writerows(rows)
print(dict(stat))
print('REVIEW rows:',len(review))
for x in review: print('  ',x[0],'|',x[1][:90],'->',x[2],'('+x[3]+')')
# stays breakdown by folder
sb=collections.Counter((f,r) for f,fn in real for r in [classify(fn,tags,settings)['rule']] if f!='(root)' and classify(fn,tags,settings)['dest']=='INBOX')
print('stays by folder/rule:',dict(sb))
rt=collections.Counter(classify(fn,tags,settings)['rule'] for f,fn in real if f=='(root)')
print('root rules:',dict(rt))

print('--- root files that would sort:')
for f,fn in real:
    if f=='(root)':
        r=classify(fn,tags,settings)
        if r['dest']!='INBOX': print('  ',fn[:80],'->',r['dest'])
import re as _re
def kind(fn):
    if _re.match(r'^(naive-)?wallhaven-',fn): return 'wallhaven'
    if _re.match(r'^\d+_p\d+',fn) or _re.match(r'^[0-9a-f]{40}',fn) or _re.match(r'^[A-Za-z0-9_-]{7,15}\.(jpg|png)$',fn) and not ' ' in fn and fn.lower()==fn.lower(): pass
    return 'other'
inbox=[fn for f,fn in real if f=='(root)' and classify(fn,tags,settings)['dest']=='INBOX']
wh=[x for x in inbox if 'wallhaven-' in x]
rest=[x for x in inbox if x not in wh]
print('inbox total',len(inbox),'| wallhaven',len(wh),'| others',len(rest))
for x in rest: print('   ',x[:100])
