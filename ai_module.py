from trust import compute_trust_score

def analyze_image(img_path):
    result = compute_trust_score(img_path)
    return result

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python ai_module.py <image_path>")
        sys.exit(1)
    
    path = sys.argv[1]
    print(f"\nAnalyzing: {path}")
    result = analyze_image(path)
    print(f"Result: {result}")