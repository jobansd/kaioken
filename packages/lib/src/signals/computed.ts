import { __DEV__ } from "../env.js"
import { Signal } from "./base.js"
import { effectQueue, tracking } from "./globals.js"
import { $HMR_ACCEPT } from "../constants.js"
import { node } from "../globals.js"
import type { HMRAccept } from "../hmr.js"
import { sideEffectsEnabled } from "../utils.js"
import { useHook } from "../hooks/utils.js"

class ComputedSignal<T> extends Signal<T> {
  protected $getter: () => T
  protected $unsubs: Map<string, Function>
  constructor(getter: () => T, displayName?: string) {
    super(null as T, displayName)
    this.$getter = getter
    this.$unsubs = new Map()

    if (__DEV__) {
      // @ts-expect-error
      this[$HMR_ACCEPT] = {
        provide: () => {
          return this
        },
        inject: (prev) => {
          super[$HMR_ACCEPT]?.inject?.(prev)

          ComputedSignal.stop(prev)
          ComputedSignal.start(this)
        },
        destroy: () => {},
      } satisfies HMRAccept<ComputedSignal<T>>
    }
  }

  get value() {
    ComputedSignal.entangle(this)
    return this.$value
  }

  // @ts-expect-error
  set value(next: T) {}

  static start<T>(computed: ComputedSignal<T>) {
    appliedTrackedSignals(computed)
  }

  static stop<T>(computed: ComputedSignal<T>) {
    effectQueue.delete(computed.$id)
    computed.$unsubs.forEach((unsub) => unsub())
    computed.$unsubs.clear()
  }

  static unsubs<T>(computed: ComputedSignal<T>) {
    return computed.$unsubs
  }

  static getter<T>(computed: ComputedSignal<T>) {
    return computed.$getter
  }
}

export const computed = <T>(
  getter: () => T,
  displayName?: string
): ComputedSignal<T> => {
  if (!node.current) {
    const computed = new ComputedSignal(getter, displayName)
    ComputedSignal.start(computed)

    return computed
  } else {
    return useHook(
      "useComputedSignal",
      {
        signal: undefined as any as ComputedSignal<T>,
      },
      ({ hook, isInit }) => {
        if (isInit) {
          hook.cleanup = () => {
            ComputedSignal.stop(hook.signal)
            Signal.subscribers(hook.signal).clear()
          }
          if (__DEV__) {
            hook.debug = {
              get: () => ({
                displayName: hook.signal.displayName,
                value: hook.signal.peek(),
              }),
            }
          }
          hook.signal = new ComputedSignal(getter, displayName)
          ComputedSignal.start(hook.signal)
        }

        return hook.signal
      }
    )
  }
}

const appliedTrackedSignals = (computedSignal: ComputedSignal<any>) => {
  const id = ComputedSignal.getId(computedSignal)
  if (effectQueue.has(id)) {
    effectQueue.delete(id)
  }
  const getter = ComputedSignal.getter(computedSignal)
  // NOTE: DO NOT call the signal notify method, UNTIL THE TRACKING PROCESS IS DONE
  tracking.enabled = true
  computedSignal.sneak(getter())
  tracking.enabled = false

  if (node.current && !sideEffectsEnabled()) {
    tracking.signals.splice(0, tracking.signals.length)
    return
  }

  const trackedSignalsIds = tracking.signals.map((sig) => Signal.getId(sig))
  const unsubs = ComputedSignal.unsubs(computedSignal)

  for (const [id, unsub] of unsubs) {
    if (trackedSignalsIds.includes(id)) continue
    unsub()
    unsubs.delete(id)
  }

  const cb = () => {
    if (!effectQueue.has(id)) {
      queueMicrotask(() => {
        if (effectQueue.has(id)) {
          const func = effectQueue.get(id)!
          func()
        }
      })
    }

    effectQueue.set(id, () => {
      appliedTrackedSignals(computedSignal)
      computedSignal.notify()
    })
  }

  tracking.signals.forEach((dependencySignal) => {
    const id = Signal.getId(dependencySignal)
    if (unsubs.get(id)) return

    const unsub = dependencySignal.subscribe(cb)
    unsubs.set(id, unsub)
  })

  tracking.signals.splice(0, tracking.signals.length)
}