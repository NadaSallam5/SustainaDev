from datasets import load_dataset

ds = load_dataset('BambusControl/AI-Code-Optimization-for-Sustainability-Dataset', split='train')

# Find good samples
good = [
    r for r in ds
    if r['input.origin'] == 'humaneval'
    and r['analysis_before.runtime.test.status'] == 'passed'
    and r['analysis_before.static.radon.complexity.total'] is not None
]

# Show 3 samples
for r in good[:3]:
    print('='*60)
    print('Task:', r['input.origin'] + '/' + str(r['input.name']))
    print('Radon complexity BEFORE:', r['analysis_before.static.radon.complexity.total'])
    print('Energy BEFORE:', r['analysis_before.runtime.energy.profiling.total_uj'], 'uJ')
    print('Test status:', r['analysis_before.runtime.test.status'])
    print()
    print('ORIGINAL CODE:')
    print(r['input.code'][:400])
    print()
    print('TEST ASSERTIONS:')
    print(str(r['input.test.assertions'])[:300])
    print()