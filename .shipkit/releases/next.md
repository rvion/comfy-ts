# next (minor)

## Hosts

### Spread runs over several GPUs
<!-- commit: a2d83c5 weight: feature -->
comfy.leastBusy(hosts) returns the host with the shortest queue; pass it to run({ host }). It counts the jobs in each server queue and the runs this process started that the server has not seen yet, so runs started together spread over the hosts. A host that does not answer is skipped.
