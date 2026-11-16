#!/bin/bash
# 10 次独立进程冷启动墙钟（ms）
d=$1
ts=()
for i in $(seq 1 10); do
  s=$(date +%s%N)
  out=$(node $d/aster.mjs eval $d/test_life.canon.json calculateBaseRate '{"age":40,"termYears":20}' 2>/dev/null)
  e=$(date +%s%N)
  ts+=($(( (e-s)/1000000 )))
done
echo "stdout=$out"
echo "runs=${ts[*]}"
printf '%s\n' "${ts[@]}" | sort -n | awk '{a[NR]=$1} END {print "median=" (a[5]+a[6])/2 "ms min=" a[1] " max=" a[NR]}'
