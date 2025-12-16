# ============================================================================
# GridTokenX Performance Analysis - LaTeX Build Makefile
# Generated: December 16, 2025
# ============================================================================

# Main document name (without extension)
MAIN = main

# LaTeX compiler
LATEX = pdflatex
BIBTEX = bibtex

# Flags
LATEXFLAGS = -interaction=nonstopmode -halt-on-error

# Output directory (optional)
# OUTDIR = build

# ============================================================================
# Default target
# ============================================================================

.PHONY: all
all: $(MAIN).pdf

# ============================================================================
# Build PDF
# ============================================================================

$(MAIN).pdf: $(MAIN).tex references.bib tables.tex figures.tex
	@echo "=== First LaTeX pass ==="
	$(LATEX) $(LATEXFLAGS) $(MAIN).tex
	@echo "=== BibTeX pass ==="
	$(BIBTEX) $(MAIN)
	@echo "=== Second LaTeX pass ==="
	$(LATEX) $(LATEXFLAGS) $(MAIN).tex
	@echo "=== Third LaTeX pass ==="
	$(LATEX) $(LATEXFLAGS) $(MAIN).tex
	@echo "=== Build complete: $(MAIN).pdf ==="

# ============================================================================
# Quick build (single pass, no bibliography)
# ============================================================================

.PHONY: quick
quick:
	$(LATEX) $(LATEXFLAGS) $(MAIN).tex

# ============================================================================
# View PDF
# ============================================================================

.PHONY: view
view: $(MAIN).pdf
ifeq ($(shell uname),Darwin)
	open $(MAIN).pdf
else ifeq ($(shell uname),Linux)
	xdg-open $(MAIN).pdf
else
	start $(MAIN).pdf
endif

# ============================================================================
# Clean auxiliary files
# ============================================================================

.PHONY: clean
clean:
	@echo "Cleaning auxiliary files..."
	rm -f $(MAIN).aux $(MAIN).bbl $(MAIN).blg $(MAIN).log
	rm -f $(MAIN).out $(MAIN).toc $(MAIN).lof $(MAIN).lot
	rm -f $(MAIN).fls $(MAIN).fdb_latexmk $(MAIN).synctex.gz
	rm -f *.aux *.bbl *.blg *.log *.out
	@echo "Clean complete."

# ============================================================================
# Clean all (including PDF)
# ============================================================================

.PHONY: cleanall
cleanall: clean
	@echo "Removing PDF..."
	rm -f $(MAIN).pdf
	@echo "Clean all complete."

# ============================================================================
# Word count (approximate)
# ============================================================================

.PHONY: count
count:
	@echo "=== Word count (approximate) ==="
	@texcount -inc -total $(MAIN).tex 2>/dev/null || \
		echo "Install texcount for word count: tlmgr install texcount"

# ============================================================================
# Spell check
# ============================================================================

.PHONY: spell
spell:
	@echo "=== Spell check ==="
	@aspell --mode=tex check $(MAIN).tex || \
		echo "Install aspell for spell check: brew install aspell"

# ============================================================================
# Lint (check for common LaTeX issues)
# ============================================================================

.PHONY: lint
lint:
	@echo "=== LaTeX lint ==="
	@chktex $(MAIN).tex 2>/dev/null || \
		echo "Install chktex for linting: tlmgr install chktex"

# ============================================================================
# Watch mode (auto-rebuild on changes)
# ============================================================================

.PHONY: watch
watch:
	@echo "=== Watch mode (Ctrl+C to stop) ==="
	@latexmk -pdf -pvc $(MAIN).tex 2>/dev/null || \
		echo "Install latexmk for watch mode: tlmgr install latexmk"

# ============================================================================
# Generate standalone figures
# ============================================================================

.PHONY: figures
figures:
	@echo "=== Building standalone figures ==="
	$(LATEX) $(LATEXFLAGS) figures.tex
	@echo "Figures built."

# ============================================================================
# Generate standalone tables
# ============================================================================

.PHONY: tables
tables:
	@echo "=== Building standalone tables ==="
	$(LATEX) $(LATEXFLAGS) tables.tex
	@echo "Tables built."

# ============================================================================
# Export to other formats
# ============================================================================

.PHONY: docx
docx: $(MAIN).pdf
	@echo "=== Converting to DOCX ==="
	@pandoc $(MAIN).tex -o $(MAIN).docx --bibliography=references.bib 2>/dev/null || \
		echo "Install pandoc for DOCX export: brew install pandoc"

.PHONY: html
html: $(MAIN).pdf
	@echo "=== Converting to HTML ==="
	@pandoc $(MAIN).tex -o $(MAIN).html --bibliography=references.bib --standalone 2>/dev/null || \
		echo "Install pandoc for HTML export: brew install pandoc"

# ============================================================================
# Help
# ============================================================================

.PHONY: help
help:
	@echo "GridTokenX Paper Build System"
	@echo "=============================="
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  all       Build PDF (default)"
	@echo "  quick     Quick build (single pass)"
	@echo "  view      Open PDF in viewer"
	@echo "  clean     Remove auxiliary files"
	@echo "  cleanall  Remove all generated files"
	@echo "  count     Word count"
	@echo "  spell     Spell check"
	@echo "  lint      LaTeX lint"
	@echo "  watch     Auto-rebuild on changes"
	@echo "  figures   Build standalone figures"
	@echo "  tables    Build standalone tables"
	@echo "  docx      Export to DOCX"
	@echo "  html      Export to HTML"
	@echo "  help      Show this help"
