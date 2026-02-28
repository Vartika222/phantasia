import os
from ai_module import analyze_image

def test_all():
    print("=" * 50)
    print("TESTING AUTHORIZED FACES")
    print("=" * 50)
    for f in os.listdir("dataset/authorized")[:3]:
        path = os.path.join("dataset/authorized", f)
        result = analyze_image(path)
        print(f"{f}: {result}")

    print("\n" + "=" * 50)
    print("TESTING UNKNOWN FACES")
    print("=" * 50)
    for f in os.listdir("dataset/unknown"):
        path = os.path.join("dataset/unknown", f)
        result = analyze_image(path)
        print(f"{f}: {result}")

    print("\n" + "=" * 50)
    print("TESTING POISON FACES")
    print("=" * 50)
    for f in os.listdir("dataset/poison"):
        path = os.path.join("dataset/poison", f)
        result = analyze_image(path)
        print(f"{f}: {result}")

if __name__ == "__main__":
    test_all()