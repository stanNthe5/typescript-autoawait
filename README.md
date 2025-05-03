# TypeScript Autoawait 

This VScode extension automatically add missing'async/await' keywords when you save a typescript file.


# Usage

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

## no-await
If you do not want some async function to be added "await", use "no-await" comment at the end of the call:

```
function test(){
    someAsyncFn() // no-await
}
```

# Performance
The first converting is slow. Then it will be fast.