with open('/tmp/da2sound16.ckb', 'rb') as f:
    data = f.read()

idx = data.find(b'ak47.wav')
if idx != -1:
    print("Found ak47.wav at", idx)
    print("Next 128 bytes:")
    print(data[idx:idx+128].hex())
