# next (minor)

## Hosts

### Spread runs over several GPUs
<!-- commit: a2d83c5 weight: feature -->
comfy.leastBusy(hosts) returns the host with the shortest queue; pass it to run({ host }). It counts the jobs in each server queue and the runs this process started that the server has not seen yet, so runs started together spread over the hosts. A host that does not answer is skipped.

## Workflows

### Each run keeps the var values it was called with
<!-- commit: a2d83c5 weight: improvement -->
run() now reads the var values when you call it, not after it connects: set a var, call run(), set it again, call run(), and each run uses its own value. A workflow can also run on another host than the one that defined it, whatever its id.
