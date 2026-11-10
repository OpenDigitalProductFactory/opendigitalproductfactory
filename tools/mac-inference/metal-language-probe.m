#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <dlfcn.h>
#include <string.h>
// f16 kernel from pinned llama.cpp b9879 (MIT); see engine.lock.json.
static void capture_backend_log(int level,const char *text,void *data) {
 (void)level;(void)data;
 if(strstr(text,"has tensor")||strstr(text,"tensor API")||strstr(text,"error compiling source")) fputs(text,stderr);
}
int main(int argc,const char **argv) { @autoreleasepool {
 if(argc==2) {
  // Pinned public ggml-metal.h API: exercise the package's actual backend,
  // without relying on server log ordering and without loading model weights.
  void *lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);
  if(!lib) return 3;
  void (*set_log)(void (*)(int,const char *,void *),void *)=dlsym(lib,"ggml_log_set");
  void *(*init)(void)=dlsym(lib,"ggml_backend_metal_init");
  void (*free_backend)(void *)=dlsym(lib,"ggml_backend_free");
  if(!set_log||!init||!free_backend) return 4;
  set_log(capture_backend_log,NULL);
  void *backend=init();
  printf("{\"backendInitialized\":%s}\n",backend?"true":"false");
  if(backend) free_backend(backend);
  return backend?0:5;
 }

 id<MTLDevice> device=MTLCreateSystemDefaultDevice();
 if (!device) return 2;
 NSString *source=@"\n#include <metal_stdlib> \n#include <metal_tensor> \n#include <MetalPerformancePrimitives/MetalPerformancePrimitives.h> \n \nusing namespace metal; \nusing namespace mpp::tensor_ops; \n \nkernel void dummy_kernel( \n    tensor<device  half, dextents<int32_t, 2>> A [[buffer(0)]], \n    tensor<device  half, dextents<int32_t, 2>> B [[buffer(1)]], \n    device float * C [[buffer(2)]], \n    uint2 tgid [[threadgroup_position_in_grid]]) \n{ \n    auto tA = A.slice(0, (int)tgid.y); \n    auto tB = B.slice((int)tgid.x, 0); \n \n    matmul2d< \n        matmul2d_descriptor(16, 16, dynamic_extent), \n        execution_simdgroups<4>> mm; \n \n    auto cT = mm.get_destination_cooperative_tensor<decltype(tA), decltype(tB), float>(); \n \n    auto sA = tA.slice(0, 0); \n    auto sB = tB.slice(0, 0); \n    mm.run(sB, sA, cT); \n \n    auto tC = tensor<device float, dextents<int32_t, 2>, tensor_inline>(C, dextents<int32_t, 2>(16, 16)); \n \n    cT.store(tC); \n}";
 NSMutableArray *rows=[NSMutableArray new];
 for (NSString *mode in @[@"baseline",@"tensor",@"fallback"]) {
  MTLCompileOptions *options=[MTLCompileOptions new];
  NSUInteger before=options.languageVersion;
  BOOL has_tensor=[mode isEqualToString:@"tensor"];
  if (has_tensor) options.languageVersion=(MTLLanguageVersion)0x40000;
  NSError *error=nil;
  BOOL compiled=NO,pipelineOK=NO;
  if (![mode isEqualToString:@"fallback"]) {
   id<MTLLibrary> lib=[device newLibraryWithSource:source options:options error:&error];
   compiled=lib!=nil;
   id<MTLFunction> fn=lib?[lib newFunctionWithName:@"dummy_kernel"]:nil;
   pipelineOK=fn&&[device newComputePipelineStateWithFunction:fn error:&error]!=nil;
  }
  [rows addObject:@{@"mode":mode,@"languageBefore":@(before),@"languageAfter":@(options.languageVersion),@"compileOK":@(compiled),@"pipelineOK":@(pipelineOK),@"fallbackUnchanged":@([mode isEqualToString:@"fallback"]&&before==options.languageVersion)}];
 }
 NSData *json=[NSJSONSerialization dataWithJSONObject:@{@"device":device.name,@"controls":rows} options:0 error:nil];
 fwrite(json.bytes,1,json.length,stdout);puts("");
 } return 0; }
