# GridTokenX Makefile
# Convenient commands for development and testing

.PHONY: help test clean build lint wallet-setup performance all

# Default target
help:
	@echo "GridTokenX Development Commands:"
	@echo ""
	@echo "Testing Commands:"
	@echo "  make test           - Run all tests"
	@echo "  make test-energy   - Run energy token tests"
	@echo "  make test-gov       - Run governance tests"
	@echo "  make test-oracle    - Run oracle tests"
	@echo "  make test-registry  - Run registry tests"
	@echo "  make test-trading   - Run trading tests"
	@echo "  make test-individual - Run all individual tests"
	@echo ""
	@echo "Development Commands:"
	@echo "  make build          - Build all programs"
	@echo "  make clean          - Clean build artifacts"
	@echo "  make lint           - Run linting"
	@echo "  make lint-fix       - Fix linting issues"
	@echo "  make wallet-setup   - Setup development wallets"
	@echo "  make performance    - Run performance tests"
	@echo "  make all           - Clean, build, and test"
	@echo ""
	@echo "Utility Commands:"
	@echo "  make deps           - Install dependencies"
	@echo "  make check          - Check project setup"
	@echo ""

# Testing commands
test:
	pnpm run test

test-energy:
	pnpm dlx ts-node tests/energy-token.test.ts

test-gov:
	pnpm dlx ts-node tests/governance.test.ts

test-oracle:
	pnpm dlx ts-node tests/oracle.test.ts

test-registry:
	pnpm dlx ts-node tests/registry.test.ts

test-trading:
	pnpm dlx ts-node tests/trading.test.ts

test-individual: test-energy test-gov test-oracle test-registry test-trading

# Development commands
build:
	anchor build

clean:
	pnpm run clean || rm -rf target/

lint:
	pnpm run lint

lint-fix:
	pnpm run lint:fix

wallet-setup:
	pnpm run wallet:setup

performance:
	pnpm run test:performance

# Combined commands
all: clean build test

# Utility commands
deps:
	pnpm install

check:
	@echo "Checking GridTokenX project setup..."
	@echo "✅ Node.js: $$(node --version)"
	@echo "✅ pnpm: $$(pnpm --version)"
	@echo "✅ Anchor: $$(anchor --version)"
	@echo "✅ Rust: $$(rustc --version)"
	@echo "✅ Solana: $$(solana --version)"
	@echo ""
	@if [ -f "tests/setup.ts" ]; then \
		echo "✅ Test framework exists"; \
	else \
		echo "❌ Test framework missing"; \
	fi
	@if [ -f "tests/utils/index.ts" ]; then \
		echo "✅ Test utilities exist"; \
	else \
		echo "❌ Test utilities missing"; \
	fi
	@if [ -f "tests/utils/mocks.ts" ]; then \
		echo "✅ Mock data exists"; \
	else \
		echo "❌ Mock data missing"; \
	fi
	@if [ -f "RUN_TESTS.md" ]; then \
		echo "✅ Test documentation exists"; \
	else \
		echo "❌ Test documentation missing"; \
	fi

# Quick start
quick-start: check all
	@echo ""
	@echo "🚀 GridTokenX is ready for development!"
	@echo "📝 See RUN_TESTS.md for detailed test commands"
	@echo "🔧 Use 'make help' to see all available commands"

# Development shortcuts
dev: quick-start

# Test with coverage
test-coverage: test
	@echo "✅ All tests completed - coverage tracking available via test framework"
