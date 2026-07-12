import sys, struct

def parse(filename):
    with open(filename, 'rb') as f:
        data = f.read()
    
    if data[:4] != b'ckmk':
        print("Not a ckmk file")
        return
        
    print("Header:", data[:4])
    
    # Try to find common file headers inside the data (e.g. OggS, RIFF, ID3)
    offsets_ogg = []
    offsets_riff = []
    for i in range(len(data)-4):
        if data[i:i+4] == b'OggS':
            offsets_ogg.append(i)
        elif data[i:i+4] == b'RIFF':
            offsets_riff.append(i)
            
    print(f"Found {len(offsets_ogg)} OggS headers at: {offsets_ogg[:5]}")
    print(f"Found {len(offsets_riff)} RIFF headers at: {offsets_riff[:5]}")
    
    # Try to list strings (filenames)
    import re
    strings = re.findall(b'[a-zA-Z0-9_\-\.]+\.wav|[a-zA-Z0-9_\-\.]+\.mp3|[a-zA-Z0-9_\-\.]+\.ogg', data)
    print("Filenames found:", list(set([s.decode('utf-8', 'ignore') for s in strings])))

parse('/tmp/da2sound16.ckb')
