# Contributing to GridTokenX

Thank you for your interest in contributing to GridTokenX! This document provides guidelines and instructions for contributing.

---

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all backgrounds and experience levels.

---

## Getting Started

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Solana CLI 1.18+
- Anchor 0.30+

### Setup

```bash
# Clone the repository
git clone https://github.com/NakaSato/gridtokenx-anchor.git
cd gridtokenx-anchor

# Install dependencies
pnpm install

# Build programs
anchor build

# Run tests
anchor test
```

---

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 2. Make Changes

- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run all tests
anchor test

# Run specific test file
anchor test -- --grep "test name"

# Check formatting
cargo fmt --check
cargo clippy
```

### 4. Commit Your Changes

Use conventional commit messages:

```bash
git commit -m "feat: add new trading feature"
git commit -m "fix: resolve order matching bug"
git commit -m "docs: update API documentation"
git commit -m "test: add integration tests for oracle"
```

Commit types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `chore`: Maintenance tasks

### 5. Push and Create PR

```bash
git push origin your-branch-name
```

Then create a Pull Request on GitHub.

---

## Code Style

### Rust

- Follow Rust idioms and best practices
- Use `cargo fmt` for formatting
- Address all `cargo clippy` warnings
- Document public functions with `///` comments

```rust
/// Registers a new user in the system.
/// 
/// # Arguments
/// * `ctx` - The program context
/// * `user_type` - Type of user (Prosumer/Consumer)
/// * `name` - User's display name
/// 
/// # Errors
/// Returns `UserAlreadyRegistered` if user exists
pub fn register_user(
    ctx: Context<RegisterUser>,
    user_type: UserType,
    name: String,
) -> Result<()> {
    // Implementation
}
```

### TypeScript

- Use TypeScript for all SDK code
- Use async/await over raw promises
- Add JSDoc comments for public APIs

```typescript
/**
 * Registers a new user in the system.
 * @param params - Registration parameters
 * @returns Transaction signature
 * @throws {UserAlreadyRegisteredError} If user exists
 */
async registerUser(params: RegisterUserParams): Promise<string> {
  // Implementation
}
```

---

## Testing Guidelines

### Unit Tests

Test individual functions in isolation:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_fee() {
        let fee = calculate_fee(1000, 100); // 1% of 1000
        assert_eq!(fee, 10);
    }
}
```

### Integration Tests

Test program interactions:

```typescript
describe('Trading', () => {
  it('should execute trade successfully', async () => {
    // Setup
    const order = await createOrder(seller, amount, price);
    
    // Execute
    await matchOrder(buyer, order);
    
    // Verify
    const sellerBalance = await getBalance(seller);
    expect(sellerBalance).to.equal(expectedAmount);
  });
});
```

---

## Documentation

- Update relevant documentation when changing functionality
- Add JSDoc/rustdoc comments for new public APIs
- Include examples in documentation

Documentation structure:
```
docs/
├── academic/      # Thesis documentation
├── technical/     # Architecture & implementation
├── guides/        # How-to guides
└── api/           # SDK & instruction reference
```

---

## Pull Request Guidelines

### PR Checklist

- [ ] Tests pass (`anchor test`)
- [ ] Code is formatted (`cargo fmt`)
- [ ] No clippy warnings (`cargo clippy`)
- [ ] Documentation updated
- [ ] Commit messages follow convention
- [ ] PR description explains changes

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How were these changes tested?

## Related Issues
Fixes #123
```

---

## Reporting Issues

### Bug Reports

Include:
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Solana version, etc.)
- Error messages/logs

### Feature Requests

Include:
- Clear description of the feature
- Use case / motivation
- Proposed implementation (optional)

---

## Questions?

- Open a [GitHub Discussion](https://github.com/NakaSato/gridtokenx-anchor/discussions)
- Check existing [Issues](https://github.com/NakaSato/gridtokenx-anchor/issues)

---

Thank you for contributing! 🎉
