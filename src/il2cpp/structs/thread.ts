namespace Il2Cpp {
    export class Thread extends NativeStruct {
        /** @internal */
        @lazy
        private static get idOffset(): number {
            const handle = ptr(Il2Cpp.currentThread!.internal.field<UInt64>("thread_id").value.toString());
            const currentThreadId = Process.getCurrentThreadId();

            for (let i = 0; i < 1024; i++) {
                try {
                    const candidate = handle.add(i).readS32();
                    if (candidate == currentThreadId) {
                        return i;
                    }
                } catch (e: any) {}
            }

            raise(`couldn't determine the offset for a native thread id value`);
        }

        /** Gets the native id of the current thread. */
        @lazy
        get id(): number {
            return ptr(this.internal.field<UInt64>("thread_id").value.toString()).add(Il2Cpp.Thread.idOffset).readS32();
        }

        /** Gets the encompassing internal object (System.Threding.InternalThreead) of the current thread. */
        @lazy
        get internal(): Il2Cpp.Object {
            return this.object.tryField<Il2Cpp.Object>("internal_thread")?.value ?? this.object;
        }

        /** Determines whether the current thread is the garbage collector finalizer one. */
        @lazy
        get isFinalizer(): boolean {
            return !Il2Cpp.Api.threadIsVm(this);
        }

        /** Gets the managed id of the current thread. */
        @lazy
        get managedId(): number {
            return this.object.method<number>("get_ManagedThreadId").invoke();
        }

        /** Gets the encompassing object of the current thread. */
        @lazy
        get object(): Il2Cpp.Object {
            return new Il2Cpp.Object(this);
        }

        /** @internal */
        @lazy
        private get staticData(): NativePointer {
            return this.internal.field<NativePointer>("static_data").value;
        }

        /** @internal */
        @lazy
        private get synchronizationContext(): Il2Cpp.Object {
            const get_ExecutionContext = this.object.tryMethod<Il2Cpp.Object>("GetMutableExecutionContext") || this.object.method("get_ExecutionContext");

            let synchronizationContext = get_ExecutionContext.invoke().tryMethod<Il2Cpp.Object>("get_SynchronizationContext")?.invoke();

            if (synchronizationContext == null) {
                const SystemThreadingSynchronizationContext = Il2Cpp.Image.corlib.class("System.Threading.SynchronizationContext");

                for (let i = 0; i < 16; i++) {
                    try {
                        const candidate = new Il2Cpp.Object(
                            this.staticData
                                .add(Process.pointerSize * i)
                                .readPointer()
                                .readPointer()
                        );
                        if (candidate.class.isSubclassOf(SystemThreadingSynchronizationContext, false)) {
                            synchronizationContext = candidate;
                            break;
                        }
                    } catch (e) {}
                }
            }

            if (synchronizationContext == null || synchronizationContext.isNull()) {
                raise("couldn't retrieve the SynchronizationContext for this thread.");
            }

            return synchronizationContext;
        }

        /** Detaches the thread from the application domain. */
        detach(): void {
            return Il2Cpp.Api.threadDetach(this);
        }

        /** Schedules a callback on the current thread. */
        schedule<T>(block: () => T | Promise<T>, delayMs: number = 0): Promise<T> {
            const MonoRuntime = Il2Cpp.Image.corlib.class("Mono.Runtime");
            const Trampoline = MonoRuntime.tryMethod("GetDisplayName") ?? MonoRuntime.method(".cctor");

            const SendOrPostCallback = Il2Cpp.Image.corlib.class("System.Threading.SendOrPostCallback").alloc();
            SendOrPostCallback.method(".ctor").invoke(NULL, Trampoline.handle);

            const Post = this.synchronizationContext.method("Post");

            return new Promise<T>(resolve => {
                const listener = Interceptor.attach(Trampoline.virtualAddress, () => {
                    if (Il2Cpp.Api.threadCurrent().equals(this)) {
                        listener.detach();
                        const result = block();
                        setImmediate(() => resolve(result));
                    }
                });

                setTimeout(() => Post.invoke(SendOrPostCallback, NULL), delayMs);
            });
        }
    }
}
