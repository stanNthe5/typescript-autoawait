# TypeScript Autoawait 

[This VScode extension](https://marketplace.visualstudio.com/items?itemName=StanNthe5.typescript-autoawait) automatically add missing 'async/await' keywords when you save a typescript file.

# Alert

This plugin is not intended for beginners. It’s simply a helper to reduce some repetitive work. You should have a solid understanding of how asynchronous behavior works in JavaScript before considering using it.

# Why

When I develop backend applications, almost all of the logic is synchronous. Having to type "async/await" over and over again felt like a meaningless chore. Sometimes, when I forgot to add "await" somewhere and had to go back to fix it, it even annoyed me. But now, things are more comfortable.

# Usage

Install the extension in VScode. There must be a "tsconfig.json" in your project folder.

# Example

## add "await" and/or "async"
### 1
```
async function test(){
    someAsyncFn()
}

```
### 2
```
function test(){
    someAsyncFn()
}

```
### 3
```
function test(){
    await someAsyncFn()
}
```
### the above 3 scripts will be converted to

```
async function test(){
    await someAsyncFn()
}

```

## no autoawait
If you do not want some async function to be added "await", use "//promise" comment at the end of the call:

```
function test(){
    someAsyncFn() // promise
```

# Performance
The first converting is slow. Then it will be fast.