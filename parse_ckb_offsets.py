import sys, struct

def parse(filename):
    with open(filename, 'rb') as f:
        data = f.read()
    
    # Very naive search for CELT or ADPCM headers or strings
    print("Total size:", len(data))
    
    # Search for "ak47.wav"
    idx = data.find(b'ak47.wav')
    if idx != -1:
        print("Found ak47.wav at", idx)
        # Check bytes around it
        print("Surrounding bytes:", data[idx-16:idx+32].hex())
        
parse('/tmp/da2sound16.ckb')
