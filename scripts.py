import os
import tiktoken

enc = tiktoken.get_encoding("o200k_base")  # GPT-5 / latest models ke liye

total_tokens = 0

for root, dirs, files in os.walk("."):
    # Ignore common directories
    IGNORE_DIRS = {
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    ".turbo",
    ".cache",
    ".idea",
    ".vscode",
}
    dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
    print(root)

    for file in files:
        if file.endswith((
            ".py", ".ts", ".tsx", ".js", ".jsx",
            ".java", ".cpp", ".c", ".go", ".rs",
            ".md", ".json", ".yml", ".yaml"
        )):
            path = os.path.join(root, file)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    total_tokens += len(enc.encode(f.read()))
            except:
                pass

print(f"Total tokens: {total_tokens:,}")