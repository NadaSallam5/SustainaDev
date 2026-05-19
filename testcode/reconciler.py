def find_duplicates(nums):
    duplicates = []

    for i in range(len(nums)):
        count = 0

        for j in range(len(nums)):
            if nums[i] == nums[j]:
                count += 1

        if count > 1:
            exists = False
            for k in range(len(duplicates)):
                if duplicates[k] == nums[i]:
                    exists = True
                    break

            if not exists:
                duplicates.append(nums[i])

    return duplicates