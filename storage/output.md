# 🧪 GOBLIN NEXUS BENCHMARK OUTPUT EVALUATION
- **Date**: 7/29/2026, 1:12:10 PM
- **Role**: Senior Software Engineer
- **Dataset ID**: `lru_cache`

---

## 📌 MODEL: `google-antigravity/claude-opus-4-6`
- **Score (Deterministic)**: ⭐ 100%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)


I'll implement a thread-safe LRU Cache using a doubly-linked list and a hash map, which is the classic O(1) approach.

```python
"""
Thread-Safe LRU Cache Implementation

Time Complexity:
    - get(key):  O(1) amortized - hash map lookup + linked list move
    - put(key, value): O(1) amortized - hash map insert/update + linked list operations

Space Complexity:
    - O(capacity) - stores at most `capacity` key-value pairs
    - Each entry has overhead for doubly-linked list node pointers and hash map entry

Thread Safety:
    - Uses threading.Lock (mutex) to serialize all read/write operations
    - Ensures correctness under concurrent access at the cost of no parallel reads
    - For read-heavy workloads, consider replacing with threading.RWLock pattern
"""

from __future__ import annotations

import threading
from typing import Generic, Hashable, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class _Node(Generic[K, V]):
    """Doubly-linked list node storing a key-value pair."""

    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key: K, value: V) -> None:
        self.key = key
        self.value = value
        self.prev: _Node[K, V] | None = None
        self.next: _Node[K, V] | None = None

    def __repr__(self) -> str:
        return f"_Node({self.key!r}, {self.value!r})"


class LRUCache(Generic[K, V]):
    """
    A thread-safe Least Recently Used (LRU) cache with O(1) get and put.

    Uses a doubly-linked list to track access order (head = most recent,
    tail = least recent) and a dict for O(1) key lookup.

    Args:
        capacity: Maximum number of items the cache can hold. Must be >= 1.

    Raises:
        ValueError: If capacity < 1.
    """

    def __init__(self, capacity: int) -> None:
        if capacity < 1:
            raise ValueError(f"Capacity must be >= 1, got {capacity}")

        self._capacity = capacity
        self._cache: dict[K, _Node[K, V]] = {}
        self._lock = threading.Lock()

        # Sentinel nodes simplify edge-case handling (no None checks on insert/remove).
        # head.next -> most recently used
        # tail.prev -> least recently used
        self._head: _Node[K, V] = _Node(None, None)  # type: ignore[arg-type]
        self._tail: _Node[K, V] = _Node(None, None)  # type: ignore[arg-type]
        self._head.next = self._tail
        self._tail.prev = self._head

    # ── Public API ──────────────────────────────────────────────────────

    def get(self, key: K) -> V | None:
        """
        Retrieve value by key. Returns None if key is absent.
        Moves the accessed node to the head (most recently used).

        Time:  O(1)
        Space: O(1)
        """
        with self._lock:
            node = self._cache.get(key)
            if node is None:
                return None
            self._move_to_head(node)
            return node.value

    def put(self, key: K, value: V) -> None:
        """
        Insert or update a key-value pair.
        If the cache exceeds capacity, the least recently used item is evicted.

        Time:  O(1)
        Space: O(1) per call (overall cache is O(capacity))
        """
        with self._lock:
            node = self._cache.get(key)

            if node is not None:
                # Key exists → update value and promote to head.
                node.value = value
                self._move_to_head(node)
            else:
                # New key → create node, add to head.
                new_node = _Node(key, value)
                self._cache[key] = new_node
                self._add_to_head(new_node)

                # Evict LRU entry if over capacity.
                if len(self._cache) > self._capacity:
                    tail_node = self._remove_tail()
                    del self._cache[tail_node.key]

    def peek(self, key: K) -> V | None:
        """Return value without updating access order. O(1)."""
        with self._lock:
            node = self._cache.get(key)
            return node.value if node else None

    @property
    def size(self) -> int:
        """Current number of items in the cache."""
        with self._lock:
            return len(self._cache)

    @property
    def capacity(self) -> int:
        return self._capacity

    def clear(self) -> None:
        """Remove all entries. O(n)."""
        with self._lock:
            self._cache.clear()
            self._head.next = self._tail
            self._tail.prev = self._head

    def keys(self) -> list[K]:
        """Return keys in order from most to least recently used. O(n)."""
        with self._lock:
            result: list[K] = []
            current = self._head.next
            while current is not self._tail:
                assert current is not None
                result.append(current.key)
                current = current.next
            return result

    # ── Private helpers (caller must hold self._lock) ───────────────────

    def _add_to_head(self, node: _Node[K, V]) -> None:
        """Insert node right after the head sentinel."""
        node.prev = self._head
        node.next = self._head.next
        self._head.next.prev = node  # type: ignore[union-attr]
        self._head.next = node

    def _remove_node(self, node: _Node[K, V]) -> None:
        """Unlink node from the doubly-linked list."""
        prev_node = node.prev
        next_node = node.next
        assert prev_node is not None and next_node is not None
        prev_node.next = next_node
        next_node.prev = prev_node

    def _move_to_head(self, node: _Node[K, V]) -> None:
        """Move existing node to head (most recently used)."""
        self._remove_node(node)
        self._add_to_head(node)

    def _remove_tail(self) -> _Node[K, V]:
        """Remove and return the node just before the tail sentinel (LRU)."""
        lru_node = self._tail.prev
        assert lru_node is not None and lru_node is not self._head
        self._remove_node(lru_node)
        return lru_node

    def __repr__(self) -> str:
        with self._lock:
            items = ", ".join(f"{k!r}: {self._cache[k].value!r}" for k in self.keys())
            return f"LRUCache(capacity={self._capacity}, items={{{items}}})"

    def __contains__(self, key: K) -> bool:
        with self._lock:
            return key in self._cache

    def __len__(self) -> int:
        return self.size


# ── Tests ───────────────────────────────────────────────────────────────


def test_basic_operations() -> None:
    cache: LRUCache[str, int] = LRUCache(2)

    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1

    # Adding "c" should evict "b" (LRU since "a" was just accessed)
    cache.put("c", 3)
    assert cache.get("b") is None
    assert cache.get("c") == 3
    assert cache.get("a") == 1


def test_update_existing_key() -> None:
    cache: LRUCache[str, int] = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("a", 10)  # Update "a", should not evict

    assert cache.get("a") == 10
    assert cache.get("b") == 2
    assert cache.size == 2


def test_capacity_one() -> None:
    cache: LRUCache[int, str] = LRUCache(1)
    cache.put(1, "one")
    assert cache.get(1) == "one"

    cache.put(2, "two")
    assert cache.get(1) is None
    assert cache.get(2) == "two"


def test_eviction_order() -> None:
    cache: LRUCache[int, int] = LRUCache(3)
    cache.put(1, 1)
    cache.put(2, 2)
    cache.put(3, 3)

    cache.get(1)   # Access order: 1, 3, 2 → LRU is 2
    cache.put(4, 4)  # Evicts 2

    assert cache.get(2) is None
    assert cache.get(1) == 1
    assert cache.get(3) == 3
    assert cache.get(4) == 4


def test_keys_order() -> None:
    cache: LRUCache[str, int] = LRUCache(3)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    # MRU → LRU: c, b, a
    assert cache.keys() == ["c", "b", "a"]

    cache.get("a")
    # MRU → LRU: a, c, b
    assert cache.keys() == ["a", "c", "b"]


def test_peek_does_not_change_order() -> None:
    cache: LRUCache[str, int] = LRUCache(3)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)

    assert cache.peek("a") == 1
    assert cache.keys() == ["c", "b", "a"]  # Order unchanged


def test_contains_and_len() -> None:
    cache: LRUCache[int, int] = LRUCache(2)
    assert len(cache) == 0
    cache.put(1, 10)
    assert 1 in cache
    assert 2 not in cache
    assert len(cache) == 1


def test_clear() -> None:
    cache: LRUCache[int, int] = LRUCache(3)
    cache.put(1, 1)
    cache.put(2, 2)
    cache.clear()
    assert len(cache) == 0
    assert cache.get(1) is None


def test_invalid_capacity() -> None:
    try:
        LRUCache(0)
        assert False, "Should have raised ValueError"
    except ValueError:
        pass

    try:
        LRUCache(-5)
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


def test_thread_safety() -> None:
    """Stress test with multiple threads reading and writing concurrently."""
    cache: LRUCache[int, int] = LRUCache(100)
    errors: list[Exception] = []

    def writer(start: int) -> None:
        try:
            for i in range(start, start + 500):
                cache.put(i, i * 10)
        except Exception as e:
            errors.append(e)

    def reader(start: int) -> None:
        try:
            for i in range(start, start + 500):
                val = cache.get(i)
                if val is not None:
                    assert val == i * 10, f"Expected {i * 10}, got {val}"
        except Exception as e:
            errors.append(e)

    threads: list[threading.Thread] = []
    for t_id in range(4):
        threads.append(threading.Thread(target=writer, args=(t_id * 500,)))
        threads.append(threading.Thread(target=reader, args=(t_id * 500,)))

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Thread safety errors: {errors}"
    assert len(cache) <= 100


if __name__ == "__main__":
    test_basic_operations()
    test_update_existing_key()
    test_capacity_one()
    test_eviction_order()
    test_keys_order()
    test_peek_does_not_change_order()
    test_contains_and_len()
    test_clear()
    test_invalid_capacity()
    test_thread_safety()
    print("All tests passed ✓")
```

## Key Design Decisions

**Data structures (O(1) operations):**
- **Hash map** (`dict`) — O(1) key lookup to find nodes
- **Doubly-linked list** — O(1) insertion/removal at arbitrary positions when you have a node reference

**Sentinel nodes** (`_head` / `_tail`):
- Eliminate all `None` checks during insert/remove operations
- No special-casing for empty list, single element, etc.

**Thread safety:**
- `threading.Lock` wraps every public method
- All linked-list mutations are internal (`_`-prefixed) and assume the lock is already held
- The stress test (`test_thread_safety`) runs 8 threads doing concurrent reads/writes

**Complexity summary:**

| Operation | Time | Space |
|-----------|------|-------|
| `get(key)` | O(1) | O(1) |
| `put(key, value)` | O(1) | O(1) per call |
| `peek(key)` | O(1) | O(1) |
| `keys()` | O(n) | O(n) |
| `clear()` | O(n) | O(1) |
| **Overall space** | — | **O(capacity)** |

---

## 📌 MODEL: `google-antigravity/gemini-2.5-flash`
- **Score (Deterministic)**: ⭐ 100%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)
To implement a thread-safe LRU cache, we use a **Doubly Linked List** to maintain order and a **Hash Map** for $O(1)$ access. We use a `std::mutex` to ensure thread safety.

### C++ Implementation

```cpp
#include <iostream>
#include <unordered_map>
#include <list>
#include <mutex>
#include <optional>

template <typename K, typename V>
class LRUCache {
private:
    using ListIter = typename std::list<std::pair<K, V>>::iterator;

    size_t capacity;
    std::list<std::pair<K, V>> items;
    std::unordered_map<K, ListIter> cache;
    mutable std::mutex mtx;

public:
    explicit LRUCache(size_t cap) : capacity(cap) {}

    /**
     * Time Complexity: O(1)
     * Space Complexity: O(1) (excluding storage)
     */
    std::optional<V> get(const K& key) {
        std::

---

## 📌 MODEL: `google-antigravity/gemini-2.5-flash-lite`
- **Score (Deterministic)**: ⭐ 80%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)
To implement a thread-safe LRU cache, we use a **Doubly Linked List** to maintain order and a **Hash Map** for $O(1)$ lookups. A `ReentrantLock` (or `Mutex`) ensures atomicity during concurrent operations.

### Implementation (Java)

```java
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;

public class LRUCache<K, V> {
    private final int capacity;
    private final Map<K, Node<K, V>> map;
    private final Node<K, V> head, tail;
    private final ReentrantLock lock = new ReentrantLock();

    private static class Node<K, V> {
        K key; V value;
        Node<K, V> prev, next;
        Node(K key, V value) { this.key = key; this.value = value; }
    }

    public LRUCache(int capacity) {
        if (capacity <= 0) throw new IllegalArgumentException("Capacity must be > 

---

## 📌 MODEL: `google-antigravity/gemini-3-flash`
- **Score (Deterministic)**: ⭐ 100%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)
Here is a complete, production-grade, thread-safe LRU (Least Recently Used) Cache implementation in Go. 

Go's standard library does not provide a built-in doubly linked list that is easy to use with generics without type assertions, so this implementation includes a lightweight, generic doubly linked list to maintain $O(1)$ operations while ensuring type safety.

### Implementation

```go
package main

import (
	"fmt"
	"sync"
)

// entry holds the key and value pair stored in the doubly linked list.
// Storing the key is necessary to locate and delete the entry from the map
// when the eviction policy (LRU) triggers.
type entry[K comparable, V any] struct {
	key   K
	value V
	prev  *entry[K, V]
	next  *entry[K, V]
}

// LRUCache represents a thread-safe Least Recently Used Cache.
// Space Complexity: O(C) where C is the capacity of the cache.
// The memory footprint is strictly bounded by the capacity limit.
type LRUCache[K comparable, V any] struct {
	mu       sync.RWMutex
	capacity int
	cache    map[K]*entry[K, V]
	head     *entry[K, V] // Dummy head node for the doubly linked list
	tail     *entry[K, V] // Dummy tail node for the doubly linked list
}

// NewLRUCache initializes and returns a new LRUCache with the given capacity.
func NewLRUCache[K comparable, V any](capacity int) (*LRUCache[K, V], error) {
	if capacity <= 0 {
		return nil, fmt.Errorf("capacity must be greater than 0, got %d", capacity)
	}

	// Initialize dummy boundary nodes to avoid nil checks during pointer manipulation.
	head := &entry[K, V]{}
	tail := &entry[K, V]{}
	head.next = tail
	tail.prev = head

	return &LRUCache[K, V]{
		capacity: capacity,
		cache:    make(map[K]*entry[K, V], capacity),
		head:     head,
		tail:     tail,
	}, nil
}

// Get retrieves the value associated with the key.
// If the key exists, it moves the node to the head (most recently used) and returns the value.
// Time Complexity: O(1) amortized.
// Space Complexity: O(1) auxiliary.
func (c *LRUCache[K, V]) Get(key K) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	node, exists := c.cache[key]
	if !exists {
		var zero V
		return zero, false
	}

	c.moveToHead(node)
	return node.value, true
}

// Put inserts or updates the value associated with the key.
// If the key already exists, its value is updated and it is moved to the head.
// If the key does not exist and the cache is at capacity, the least recently used
// item (at the tail) is evicted before inserting the new item.
// Time Complexity: O(1) amortized.
// Space Complexity: O(1) auxiliary.
func (c *LRUCache[K, V]) Put(key K, value V) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if node, exists := c.cache[key]; exists {
		node.value = value
		c.moveToHead(node)
		return
	}

	// Evict the oldest item if capacity is reached
	if len(c.cache) >= c.capacity {
		removed := c.removeTail()
		if removed != nil {
			delete(c.cache, removed.key)
		}
	}

	// Create and insert the new node
	newNode := &entry[K, V]{key: key, value: value}
	c.cache[key] = newNode
	c.addToHead(newNode)
}

// Len returns the current number of elements in the cache.
// Time Complexity: O(1)
func (c *LRUCache[K, V]) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.cache)
}

// Internal Helper Methods (Must be called while holding the mutex lock)

// addToHead inserts a node right after the dummy head.
func (c *LRUCache[K, V]) addToHead(node *entry[K, V]) {
	node.prev = c.head
	node.next = c.head.next

	c.head.next.prev = node
	c.head.next = node
}

// removeNode detaches a node from its current position in the linked list.
func (c *LRUCache[K, V]) removeNode(node *entry[K, V]) {
	node.prev.next = node.next
	node.next.prev = node.prev
}

// moveToHead moves an existing node to the head of the list (marking it as most recently used).
func (c *LRUCache[K, V]) moveToHead(node *entry[K, V]) {
	c.removeNode(node)
	c.addToHead(node)
}

// removeTail evicts the least recently used node (just before the dummy tail) and returns it.
func (c *LRUCache[K, V]) removeTail() *entry[K, V] {
	if c.tail.prev == c.head {
		return nil // Cache is empty
	}
	node := c.tail.prev
	c.removeNode(node)
	return node
}

func main() {
	// Initialize a cache of capacity 2
	cache, _ := NewLRUCache[string, int](2)

	cache.Put("one", 1)
	cache.Put("two", 2)

	if val, ok := cache.Get("one"); ok {
		fmt.Printf("Found: %d\n", val) // Prints 1
	}

	// This put operation exceeds capacity (2), evicting "two" because "one" was accessed recently.
	cache.Put("three", 3)

	_, ok1 := cache.Get("two")
	fmt.Printf("Key 'two' exists: %v\n", ok1) // Prints false (Evicted)

	_, ok2 := cache.Get("one")
	fmt.Printf("Key 'one' exists: %v\n", ok2) // Prints true
}
```

### Complexity Analysis

| Operation | Time Complexity | Space Complexity | Details |
| :--- | :--- | :--- | :--- |
| **`Get(key)`** | $\mathcal{O}(1)$ | $\mathcal{O}(1)$ | Hashmap lookup is $\mathcal{O}(1)$ on average. Moving the node in the doubly linked list requires rearranging 4 pointers, which is $\mathcal{O}(1)$. |
| **`Put(key, value)`** | $\mathcal{O}(1)$ | $\mathcal{O}(1)$ | Insertion/updates in the hashmap and node pointer manipulation are both $\mathcal{O}(1)$ amortized operations. |
| **Space Complexity** | N/A | $\mathcal{O}(C)$ | Where $C$ is the maximum capacity. The space used scales linearly with the configured capacity limit. |

---

## 📌 MODEL: `google-antigravity/gemini-3.1-flash-image`
- **Score (Deterministic)**: ⭐ 100%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)
```python
import collections
from threading import RLock

class LRUCache:
  """
  An LRU (Least Recently Used) cache implementation.

  This cache has a capacity limit. When the capacity is reached,
  the least recently used item is evicted. The operations `get` and `put`
  are both thread-safe and run in O(1) time complexity. The space complexity
  is O(capacity).
  """

  def __init__(self, capacity):
    """
    Initializes the LRUCache with the given capacity.

    Args:
      capacity: The maximum number of items the cache can hold.
    """
    self.capacity = capacity
    self.cache = collections.OrderedDict()
    self.lock = RLock()

  def get(self, key):
    """
    Returns the value of the key if it exists, otherwise -1.

    If the key is found, it is moved to the end of the cache
    (marking it as recently used). This operation runs in O(1) time.

    Args:
      key: The key to

---

## 📌 MODEL: `google-antigravity/gemini-3.1-flash-lite`
- **Score (Deterministic)**: ⭐ 100%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)
To implement a thread-safe LRU cache, we use a combination of a `dict` for $O(1)$ lookups and a `collections.OrderedDict` (or a doubly linked list) to maintain access order. For thread safety, we utilize `threading.Lock` to ensure atomic operations.

### Implementation

```python
import threading
from collections import OrderedDict
from typing import Any, Optional

class LRUCache:
    """
    A thread-safe LRU Cache implementation.
    
    Complexity Analysis:
    - Time Complexity:
        - get(key): O(1) average.
        - put(key, value): O(1) average.
    - Space Complexity: O(C), where C is the capacity of the cache.
    """
    
    def __init__(self, capacity: int):
        if capacity <= 0:
            raise ValueError("Capacity must be a positive integer.")
        self.capacity = capacity
        self.cache: OrderedDict[Any, Any] = OrderedDict()
        self.lock = threading.Lock()

    def get(self, key: Any) -> Optional

---

## 📌 MODEL: `google-antigravity/gemini-3.5-flash`
- **Score (Deterministic)**: ⭐ 100%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)
Here is a complete, thread-safe implementation of an LRU (Least Recently Used) Cache in C++ using clean code principles, strong typing, and appropriate synchronization primitives.

### Implementation

We use a combination of a **doubly linked list** (to maintain the usage order with $O(1)$ updates) and a **hash map** (to achieve $O(1)$ lookups). Thread safety is ensured using a `std::shared_mutex` to allow concurrent reads (`get` operations) while ensuring exclusive access for writes (`put` operations).

```cpp
#include <iostream>
#include <unordered_map>
#include <list>
#include <shared_mutex>
#include <optional>
#include <utility>
#include <cassert>

/**
 * @brief A thread-safe Least Recently Used (LRU) Cache.
 * 
 * Space Complexity: O(C) where C is the capacity of the cache.
 *   - The hash map stores at most C elements.
 *   - The doubly linked list stores at most C elements.
 * 
 * Time Complexity:
 *   - get(key): O(1) average case. Acquires a shared lock for lookup, 
 *               upgrades to unique lock only if the key is found (to promote it).
 *   - put(key, value): O(1) average case. Acquires a unique lock.
 */
template <typename Key, typename Value>
class LRUCache {
public:
    explicit LRUCache(size_t capacity) : capacity_(capacity) {
        if (capacity_ == 0) {
            throw std::invalid_argument("Capacity must be greater than 0");
        }
    }

    // Disable copy semantics to prevent accidental copying of mutexes
    LRUCache(const LRUCache&) = delete;
    LRUCache& operator=(const LRUCache&) = delete;
    
    // Allow move semantics
    LRUCache(LRUCache&&) noexcept = default;
    LRUCache& operator=(LRUCache&&) noexcept = default;

    /**
     * @brief Retrieves the value associated with the key.
     *        Moves the accessed key to the front (most recently used).
     * 
     * Time Complexity: O(1)
     * Thread Safety: Read-Write Lock (Shared access initially, promoted to exclusive on hit).
     * 
     * @param key The key to look up.
     * @return std::optional<Value> The value if found, or std::nullopt.
     */
    std::optional<Value> get(const Key& key) {
        std::unique_lock<std::shared_mutex> lock(mutex_);
        
        auto it = cache_map_.find(key);
        if (it == cache_map_.end()) {
            return std::nullopt;
        }

        // Move the accessed node to the front of the list (MRU)
        cache_list_.splice(cache_list_.begin(), cache_list_, it->second);
        return it->second->value;
    }

    /**
     * @brief Inserts or updates a key-value pair.
     *        If the capacity is exceeded, the least recently used item is evicted.
     * 
     * Time Complexity: O(1)
     * Thread Safety: Exclusive Lock.
     * 
     * @param key The key to insert or update.
     * @param value The value to associate with the key.
     */
    void put(const Key& key, const Value& value) {
        std::unique_lock<std::shared_mutex> lock(mutex_);

        auto it = cache_map_.find(key);
        if (it != cache_map_.end()) {
            // Key exists: update value and move to front
            it->second->value = value;
            cache_list_.splice(cache_list_.begin(), cache_list_, it->second);
            return;
        }

        // Key does not exist: Check capacity and evict if necessary
        if (cache_list_.size() >= capacity_) {
            evict_least_recently_used();
        }

        // Insert new node at the front of the list
        cache_list_.emplace_front(key, value);
        cache_map_[key] = cache_list_.begin();
    }

    /**
     * @brief Helper to check the current size of the cache.
     */
    size_t size() const {
        std::shared_lock<std::shared_mutex> lock(mutex_);
        return cache_list_.size();
    }

private:
    struct CacheNode {
        Key key;
        Value value;
        CacheNode(Key k, Value v) : key(std::move(k)), value(std::move(v)) {}
    };

    // Helper method to evict the LRU element. Must be called under a unique lock.
    void evict_least_recently_used() {
        if (cache_list_.empty()) return;
        
        const Key& lru_key = cache_list_.back().key;
        cache_map_.erase(lru_key);
        cache_list_.pop_back();
    }

    const size_t capacity_;
    
    // List to maintain the LRU order (front = MRU, back = LRU)
    std::list<CacheNode> cache_list_;
    
    // Hash map for O(1) lookups pointing to list iterators
    std::unordered_map<Key, typename std::list<CacheNode>::iterator> cache_map_;
    
    // Mutex to protect shared state
    mutable std::shared_mutex mutex_;
};

// ============================================================================
// Verification / Example Usage
// ============================================================================

int main() {
    LRUCache<int, std::string> cache(2);

    // Test basic Put & Get
    cache.put(1, "one");
    cache.put(2, "two");
    
    assert(cache.get(1) == "one"); 
    
    // Eviction test: capacity is 2. Putting 3 should evict 2 (since 1 was accessed via get(1))
    cache.put(3, "three");
    
    assert(cache.get(2) == std::nullopt); // Evicted
    assert(cache.get(1) == "one");
    assert(cache.get(3) == "three");

    std::cout << "All LRU Cache tests passed successfully!" << std::endl;
    return 0;
}
```

### Key Technical Decisions:
1. **`std::shared_mutex`**: We use a reader-writer lock. While `get` updates the internal list (requiring a write lock structure modification), using a unique lock is necessary. If your use case is highly read-heavy and you want to avoid write-locking on `get()`, you would need to look into lock-free structures or Relaxed LRU approximations (like Segmented LRU or W-TinyLFU).
2. **`std::list::splice`**: Allows moving nodes within the `std::list` to the front in $O(1)$ time without deallocating or reallocating memory, keeping iterators in the `unordered_map` valid.

---

## 📌 MODEL: `google-antigravity/gemini-3.6-flash`
- **Score (Deterministic)**: ⭐ 100%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)
Here is a complete, production-ready, thread-safe LRU (Least Recently Used) Cache implementation in Python using the `threading` module and a combination of a hash map and a doubly linked list.

### Implementation

```python
import threading
from typing import Generic, TypeVar, Optional, Dict

K = TypeVar('K')
V = TypeVar('V')

class Node(Generic[K, V]):
    """Doubly Linked List Node to store key-value pairs."""
    def __init__(self, key: Optional[K] = None, value: Optional[V] = None):
        self.key: Optional[K] = key
        self.value: Optional[V] = value
        self.prev: Optional['Node[K, V]'] = None
        self.next: Optional['Node[K, V]'] = None


class LRUCache(Generic[K, V]):
    """
    Thread-safe LRU Cache implementation using a Hash Map and Doubly Linked List.
    
    Time Complexity:
        - get(key): O(1)
        - put(key

---

## 📌 MODEL: `google-antigravity/gpt-oss-120b`
- **Score (Deterministic)**: ⭐ 100%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)
**Thread‑safe LRU Cache (Python 3.11+)**

```python
# -*- coding: utf-8 -*-
"""
Thread‑safe Least‑Recently‑Used (LRU) cache.

Public API
----------
* LRUCache(capacity: int) – creates a cache that holds at most *capacity* items.
* get(key) -> Optional[V] – returns the value for *key* or ``None`` if missing.
* put(key

---

## 📌 MODEL: `google-antigravity/tab_flash_lite_preview`
- **Score (Deterministic)**: ⭐ 80%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)
```typescript
/**
 * Represents a node in the Doubly Linked List used for the LRU Cache.
 * Each node stores a key-value pair and has pointers to the previous and next nodes.
 */
class Node<K, V> {
    key: K;
    value: V;
    prev: Node<K, V> | null = null;
    next: Node<K, V> | null = null;

    constructor(key: K, value: V) {
        this.key = key;
        this.value = value;
    }
}

/**
 * A thread-safe (in a single-threaded JavaScript/TypeScript environment)
 * Least Recently Used (LRU) Cache implementation.
 *
 * This cache evicts the least recently used items when the capacity is reached.
 * It uses a Map for O(1) key lookup and a Doubly Linked List to maintain
 * the order of usage (most recent at the head, least recent at the tail).
 *
 * @template K The type of the keys in the cache.
 * @template V The type of the values in the cache.


---

## 📌 MODEL: `google-antigravity/tab_jump_flash_lite_preview`
- **Score (Deterministic)**: ⭐ 100%

### ❓ Prompt (Soal)
```text
Implement a thread-safe LRU Cache with capacity limit, get(key), and put(key, value) operations. Include time/space complexity analysis in comments.
```

### 💡 Model Response (Jawaban)
This implementation uses Python's `collections.OrderedDict`, which is inherently thread-safe in terms of its internal data structure (operations like `move_to_end` are atomic). We wrap it with a `threading.Lock` to ensure atomicity for multi-key operations like `put` or `get` that modify the cache state, preventing race conditions between `get` and `put` or multiple `put` operations.

```python
import threading
from collections import OrderedDict
from typing import Any, Optional, Dict, Tuple, List, Union

# Type alias for key-value pairs
CacheEntry = Tuple[Any, Any]


class ThreadSafeLRUCache:
    """
    A thread-safe Least Recently Used (LRU) Cache with a fixed capacity.

    This implementation utilizes collections.OrderedDict for efficient
    ordering and an internal threading.Lock to ensure atomicity across
    get and put operations.
    """

    def __init__(self, capacity: int):
        """
        Initializes the LRU Cache.

        Time Complexity: O(1) - Only capacity validation and structure creation.
        Space Complexity: O(1) -

---
